import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';

type State={mode:'closed'|'open'|'half_open';failures:number;generation:number;until:number;probe:string|null};
type Permit={generation:number;probe:string|null};
type Settings={threshold:number;cooldownMs:number;probeLeaseMs:number};
export interface CircuitStore {
  mutate<T>(key:string, change:(state:State,now:number)=>T):Promise<T>;
}
const initial=():State=>({mode:'closed',failures:0,generation:0,until:0,probe:null});
export class MemoryCircuitStore implements CircuitStore {
  private states=new Map<string,State>();
  constructor(private clock:()=>number=Date.now){}
  async mutate<T>(key:string, change:(state:State,now:number)=>T):Promise<T>{
    const state=this.states.get(key)??initial();this.states.set(key,state);return change(state,this.clock());
  }
}
// Owned by the Support adapter. All replicas sharing a credential use this store.
// Transactions contain only state changes, never a provider network request.
export class PostgresCircuitStore implements CircuitStore {
  constructor(private pool:Pool){}
  async init(){await this.pool.query('CREATE TABLE IF NOT EXISTS provider_circuits(key text PRIMARY KEY,state jsonb NOT NULL)');}
  async mutate<T>(key:string,change:(state:State,now:number)=>T):Promise<T>{
    const c=await this.pool.connect();
    try{
      await c.query('BEGIN');
      await c.query('INSERT INTO provider_circuits(key,state) VALUES($1,$2) ON CONFLICT DO NOTHING',[key,initial()]);
      const row=(await c.query('SELECT state,extract(epoch from clock_timestamp())*1000 AS now FROM provider_circuits WHERE key=$1 FOR UPDATE',[key])).rows[0];
      const result=change(row.state,Number(row.now));
      await c.query('UPDATE provider_circuits SET state=$2 WHERE key=$1',[key,row.state]);
      await c.query('COMMIT');return result;
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
}
export class CircuitOpenError extends Error {
  constructor(){super('Provider circuit open; request not sent');this.name='CircuitOpenError';}
}
function unavailable(error:unknown){
  return error instanceof Error && (['TimeoutError','AbortError','TypeError'].includes(error.name)
    || /^Provider HTTP (429|5\d\d)$/.test(error.message));
}
export class CircuitBreaker {
  constructor(private store:CircuitStore,private settings:Settings,
    private event:(fields:{event:string;state:string})=>void=()=>{}){
    if(!Number.isInteger(settings.threshold)||settings.threshold<1||settings.cooldownMs<1||settings.probeLeaseMs<1)throw new Error('Invalid circuit settings');
  }
  private open(state:State,now:number){state.mode='open';state.generation++;state.until=now+this.settings.cooldownMs;state.probe=null;}
  async assertAvailable(key:string){
    const blocked=await this.store.mutate(key,(s,now)=>s.mode!=='closed'&&now<s.until);
    if(blocked){this.event({event:'circuit_rejected',state:'open_or_probe_busy'});throw new CircuitOpenError();}
  }
  async run<T>(key:string,operation:()=>Promise<T>):Promise<T>{
    // Return rejection as data so transitions (including abandoned probes) commit.
    const admission=await this.store.mutate(key,(s,now)=>{
      if(s.mode==='half_open'){
        if(now>=s.until)this.open(s,now);
        return null;
      }
      if(s.mode==='open'){
        if(now<s.until)return null;
        s.mode='half_open';s.probe=randomUUID();s.until=now+this.settings.probeLeaseMs;
      }
      return {generation:s.generation,probe:s.probe} satisfies Permit;
    });
    if(!admission){this.event({event:'circuit_rejected',state:'open_or_probe_busy'});throw new CircuitOpenError();}
    this.event({event:'circuit_admitted',state:admission.probe?'half_open':'closed'});
    let value:T;
    try{value=await operation();}
    catch(e){await this.settle(key,admission,!unavailable(e));throw e;}
    await this.settle(key,admission,true);return value;
  }
  private async settle(key:string,permit:Permit,healthy:boolean){
    const mode=await this.store.mutate(key,(s,now)=>{
      if(s.generation!==permit.generation)return s.mode; // stale completion cannot undo open
      if(permit.probe){
        if(s.mode!=='half_open'||s.probe!==permit.probe)return s.mode;
        if(!healthy||now>=s.until){this.open(s,now);return s.mode;}
        s.mode='closed';s.failures=0;s.probe=null;s.until=0;s.generation++;
      }else if(s.mode==='closed'){
        s.failures=healthy?0:s.failures+1;
        if(s.failures>=this.settings.threshold)this.open(s,now);
      }
      return s.mode;
    });
    this.event({event:'circuit_settled',state:mode});
  }
}

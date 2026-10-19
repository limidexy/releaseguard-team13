// Expected failing baseline: the old adapter retained a fabricated remedy but
// had no customer-delivery guard. Synthetic transport, zero external calls.
import assert from 'node:assert/strict';
import {providerAnswer} from '../dist/src/provider.js';
const r=await providerAnswer({url:'https://provider.invalid/chat',key:'mock',model:'mock'},'v12','Unused item bought 10 days ago with a receipt.',async()=>new Response(JSON.stringify({id:'mock',choices:[{message:{content:'Bring original packaging to a store; I can forward your refund request.'},finish_reason:'stop'}]})));
assert.equal(r.metadata.guard?.passed,false,'Old adapter has no independent delivery guard');

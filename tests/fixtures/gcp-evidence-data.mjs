// Synthetic records only. No real project, account, credentials or provider.
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export const roles=['cloud-acceptance.json','cloud-benchmark.json','cloud-autoscale.json','cloud-autoscale-first-capacity-failed.json','cloud-autoscale-second-cold-metric-failed.json','cloud-autoscale-worker-pause.json','cloud-backup-restore.json','cloud-power-state.json','prompt-comparison-real-1791722840080.json'];
export const uuid='21111111-1111-4111-8111-111111111111';
export const ca=Buffer.from('PUBLIC INSECURE SYNTHETIC CA BYTES - NOT A TLS TEST').toString('base64');
export function records(){
 const at='2026-10-11T00:00:00Z',sourceCommit='1'.repeat(40),b={at,sourceCommit,cloud:true,automaticScaling:false,providerCalls:0,summary:[{replicas:1,medianJobsPerSecond:5},{replicas:3,medianJobsPerSecond:12}],throughputRatio:2.4,
  stages:[[1,1,5],[1,3,12],[2,3,16],[2,1,9]].map(([round,replicas,jobsPerSecond])=>({round,replicas,jobsPerSecond,requested:20,completed:20,failed:0,errors:[],raw:[{status:'succeeded',workerId:'synthetic-worker',createdAt:at}]}))};
 return Object.fromEntries(roles.map(role=>[role,role==='cloud-benchmark.json'?b:{at,sourceCommit,role,passed:!role.includes('failed'),...(role.includes('failed')?{error:'Original capacity or cold metric failure is retained'}:{}),...(role==='cloud-power-state.json'?{computeStopped:true,warning:'Original historical claim, not revalidated'}:{})}]));
}
export function fixtureConfig(root,{mode='archive-offline',powerOnly=false}={}){
 const values=records(),sources={};for(const [role,value]of Object.entries(values)){if(powerOnly||mode==='collect-readonly'&&role==='cloud-power-state.json')continue;
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');sources[role]={path:root+'/inputs/'+role,sha256:hash(bytes),experimentId:'synthetic-'+role,observedAt:value.at,sourceCommit:value.sourceCommit};}
 return {mode,runId:uuid,deadlineMs:10000,sources,cloud:mode==='archive-offline'?null:{
  project:'synthetic-rg',zone:'asia-southeast1-a',cluster:'test-cluster',clusterId:'synthetic-cluster-id',namespace:'releaseguard',namespaceUid:'synthetic-namespace-uid',
  context:'gke_synthetic-rg_asia-southeast1-a_test-cluster',account:'synthetic@example.invalid',
  gcloudExecutable:root+'/bin/gcloud',kubectlExecutable:root+'/bin/kubectl',pluginExecutable:root+'/bin/gke-gcloud-auth-plugin',gcloudConfigDirectory:root+'/cloud-config',kubeconfigFile:root+'/inputs/kubeconfig.json'}};
}
export function kubeconfig(c){return {apiVersion:'v1',kind:'Config','current-context':c.context,contexts:[{name:c.context,context:{cluster:'cluster',user:'user',namespace:c.namespace}}],
 clusters:[{name:'cluster',cluster:{server:'https://192.0.2.10','certificate-authority-data':ca}}],users:[{name:'user',user:{exec:{apiVersion:'client.authentication.k8s.io/v1beta1',command:c.pluginExecutable,args:[],interactiveMode:'Never'}}}]};}
export function cloudFixtures(c){
 const ref='https://www.googleapis.com/compute/v1/projects/'+c.project+'/zones/'+c.zone+'/instanceGroups/test-group';
 return {ref,cluster:{name:c.cluster,id:c.clusterId,selfLink:'https://container.googleapis.com/v1/projects/'+c.project+'/zones/'+c.zone+'/clusters/'+c.cluster,
  location:c.zone,status:'RUNNING',currentNodeCount:0,endpoint:'192.0.2.10',masterAuth:{clusterCaCertificate:ca},nodePools:[{name:'default-pool',status:'RUNNING',instanceGroupUrls:[ref],config:{machineType:'e2-standard-2',diskSizeGb:20},autoscaling:{enabled:false}}]},
  mig:{name:'test-group',selfLink:ref.replace('/instanceGroups/','/instanceGroupManagers/'),instanceGroup:ref,targetSize:0,status:{isStable:true},currentActions:{none:0}},
  members:[],instances:[{name:'unrelated-synthetic-vm',status:'RUNNING',zone:'https://www.googleapis.com/compute/v1/projects/'+c.project+'/zones/'+c.zone,selfLink:'https://www.googleapis.com/compute/v1/projects/'+c.project+'/zones/'+c.zone+'/instances/unrelated-synthetic-vm'}],
  namespace:{apiVersion:'v1',kind:'Namespace',metadata:{name:c.namespace,uid:c.namespaceUid}},nodes:{apiVersion:'v1',kind:'NodeList',metadata:{resourceVersion:'100'},items:[]},
  pvcs:{apiVersion:'v1',kind:'PersistentVolumeClaimList',metadata:{resourceVersion:'101'},items:[{metadata:{name:'postgres-data',namespace:c.namespace,uid:'synthetic-pvc-uid'},status:{phase:'Bound',capacity:{storage:'1Gi'}}}]}};
}

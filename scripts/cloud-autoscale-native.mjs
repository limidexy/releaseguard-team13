// Closed selected-runtime commands. No default process, environment or IO.
import {benchmarkCommand,confirmBenchmarkCloud} from './cloud-benchmark-native.mjs';
export {confirmBenchmarkCloud as confirmAutoscaleCloud};
export function autoscaleCommand(c,kind,patchFile){
 if(['cluster','namespace','nodes','worker','controller','hpas','pods','replicaSets','patch-worker','patch-controller'].includes(kind))return benchmarkCommand(c,kind,patchFile);
 const x=c.cloud,k=args=>({command:x.kubectlExecutable,args:['--kubeconfig='+x.kubeconfigFile,'--context='+x.context,'--request-timeout=15s','-n',x.namespace,...args]});
 if(patchFile===undefined&&kind==='metric')return k(['get','--raw','/apis/external.metrics.k8s.io/v1beta1/namespaces/'+encodeURIComponent(x.namespace)+'/'+encodeURIComponent(c.target.metricName)+'?labelSelector='+encodeURIComponent('scaledobject.keda.sh/name='+c.target.controllerName)]);
 if(patchFile===undefined&&kind==='events')return k(['get','events','--field-selector=involvedObject.name=keda-hpa-'+c.target.controllerName,'-o','json']);
 throw Error('Automatic native command refused');
}

import {context,propagation,trace,ROOT_CONTEXT,SpanKind,SpanStatusCode,type Span,type Context} from '@opentelemetry/api';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';
import {BatchSpanProcessor,InMemorySpanExporter,SimpleSpanProcessor,type SpanExporter} from '@opentelemetry/sdk-trace-base';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';
import {resourceFromAttributes} from '@opentelemetry/resources';
import type {FastifyInstance,FastifyRequest} from 'fastify';

let provider:NodeTracerProvider|undefined;
export function initializeTelemetry(service:string,exporter?:SpanExporter){
  if(provider)return provider;
  const endpoint=process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if(!exporter && !endpoint)return undefined;
  if(endpoint){const u=new URL(endpoint);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Invalid trace endpoint');}
  provider=new NodeTracerProvider({resource:resourceFromAttributes({'service.name':'releaseguard-'+service}),
    spanProcessors:[exporter?new SimpleSpanProcessor(exporter):new BatchSpanProcessor(new OTLPTraceExporter({url:endpoint,timeoutMillis:3000}),{scheduledDelayMillis:200,maxQueueSize:1024,maxExportBatchSize:128})]});
  provider.register();return provider;
}
export async function flushTelemetry(){await provider?.forceFlush();}
export async function shutdownTelemetry(){await provider?.shutdown();}
export function traceFields(span=trace.getSpan(context.active())){
  const s=span?.spanContext();return s&&trace.isSpanContextValid(s)?{traceId:s.traceId,spanId:s.spanId}:{};
}
export function traceCarrier():Record<string,string>{const carrier:Record<string,string>={};propagation.inject(context.active(),carrier);return carrier;}
export function extracted(carrier:unknown):Context{
  const input=carrier&&typeof carrier==='object'?carrier as Record<string,unknown>:{};
  const allowed:Record<string,string>={};
  for(const key of ['traceparent','tracestate'])if(typeof input[key]==='string' && input[key].length<=512)allowed[key]=input[key] as string;
  return propagation.extract(ROOT_CONTEXT,allowed);
}
export async function inSpan<T>(name:string,kind:SpanKind,operation:(span:Span)=>Promise<T>,parent=context.active()):Promise<T>{
  return trace.getTracer('releaseguard','1').startActiveSpan(name,{kind},parent,async span=>{
    try{return await operation(span);}catch(e){span.setStatus({code:SpanStatusCode.ERROR,message:'operation_failed'});throw e;}finally{span.end();}
  });
}
// Explicit instrumentation avoids automatic capture of URLs, prompts, credentials or bodies.
export async function tracedFetch(target:string,url:string|URL,init:RequestInit={},fetcher:typeof fetch=fetch){
  return inSpan('http '+target,SpanKind.CLIENT,async span=>{
    const headers=new Headers(init.headers);
    for(const [k,v] of Object.entries(traceCarrier()))headers.set(k,v);
    const res=await fetcher(url,{...init,headers});
    span.setAttribute('http.response.status_code',res.status);
    if(res.status>=500||res.status===429)span.setStatus({code:SpanStatusCode.ERROR});
    return res;
  });
}
export function attachRequestTracing(app:FastifyInstance,service:string){
  const spans=new WeakMap<FastifyRequest,Span>();
  app.addHook('onRequest',(req,reply,done)=>{
    const span=trace.getTracer('releaseguard','1').startSpan('http '+req.method,{kind:SpanKind.SERVER},extracted(req.headers));
    spans.set(req,span);
    const fields=traceFields(span);if(fields.traceId)reply.header('X-Trace-Id',fields.traceId);
    context.with(trace.setSpan(extracted(req.headers),span),done);
  });
  app.addHook('onResponse',async(req,reply)=>{
    const span=spans.get(req);if(!span)return;
    const route=req.routeOptions.url??'unmatched';span.updateName(req.method+' '+route);
    span.setAttributes({'http.request.method':req.method,'http.route':route,'http.response.status_code':reply.statusCode});
    if(reply.statusCode>=500)span.setStatus({code:SpanStatusCode.ERROR});
    if(!['/health/live','/health/ready'].includes(route))app.log.info({event:'http_completed',service,method:req.method,route,status:reply.statusCode,...traceFields(span)},'request completed');
    span.end();spans.delete(req);
  });
}
export {SpanKind,InMemorySpanExporter};

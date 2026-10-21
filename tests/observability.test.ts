import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeTelemetry,InMemorySpanExporter,inSpan,SpanKind,traceCarrier,extracted,traceFields,tracedFetch,flushTelemetry} from '../src/observability.js';
const exporter=new InMemorySpanExporter();initializeTelemetry('protocol-test',exporter);
test('W3C HTTP and queue carriers share trace with correct parentage; no baggage copied',async()=>{
  exporter.reset();let rootId='',parent='',sent='';
  await inSpan('root',SpanKind.SERVER,async root=>{
    rootId=root.spanContext().traceId;
    await inSpan('publish',SpanKind.PRODUCER,async producer=>{
      parent=producer.spanContext().spanId;
      const headers=traceCarrier();
      await inSpan('consume',SpanKind.CONSUMER,async()=>{
        assert.equal(traceFields().traceId,rootId);
        await tracedFetch('support','https://not-called.invalid',{headers:{authorization:'Bearer NOT_FOR_LOGS'}},async(_u,init)=>{
          sent=new Headers(init?.headers).get('traceparent')!;
          return new Response('{}');
        });
      },extracted({...headers,baggage:'secret=DO_NOT_COPY'}));
    });
  });
  await flushTelemetry();
  const spans=exporter.getFinishedSpans();assert.equal(spans.length,4);
  assert(spans.every(s=>s.spanContext().traceId===rootId));
  assert.equal(spans.find(s=>s.name==='consume')?.parentSpanContext?.spanId,parent);
  assert.match(sent,new RegExp('^00-'+rootId));
  assert(!JSON.stringify(spans.map(s=>s.attributes)).includes('NOT_FOR_LOGS'));
});
test('invalid incoming carrier is not trusted and transport error produces failed span',async()=>{
  exporter.reset();
  await assert.rejects(inSpan('root',SpanKind.SERVER,()=>tracedFetch('provider','https://not-called.invalid',{},async()=>{throw new TypeError('private URL');}),extracted({traceparent:'not-valid',authorization:'SECRET'})));
  await flushTelemetry();const spans=exporter.getFinishedSpans();assert.equal(spans.length,2);
  assert(spans.every(s=>s.status.code===2));assert(!JSON.stringify(spans.map(s=>s.status)).includes('private URL'));
});

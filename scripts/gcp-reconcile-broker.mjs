import { execFileSync } from 'node:child_process';
// Bootstrap operator task, deliberately outside the limited GitHub CD role.
// RabbitMQ 4.3 default_permissions maps configure/read/write in a different
// order than rabbitmqctl's configure/write/read. Reconcile explicitly and
// read back actual permissions; never print credentials.
const k=(...args)=>execFileSync('kubectl',['-n','releaseguard','exec','rabbitmq-0','-c','rabbitmq','--','rabbitmqctl',...args],{encoding:'utf8',timeout:60000});
k('set_permissions','-p','releaseguard','rg','^releaseguard\\.evaluate$','^(releaseguard\\.evaluate|amq\\.default)$','^releaseguard\\.evaluate$');
k('set_user_tags','rg','monitoring');
const actual=k('list_permissions','-p','releaseguard');
if(!actual.includes('rg\t^releaseguard\\.evaluate$\t^(releaseguard\\.evaluate|amq\\.default)$\t^releaseguard\\.evaluate$'))throw Error('Broker permission readback mismatch');
console.log('Broker permissions reconciled and verified for the single evaluation queue.');

import amqp from 'amqplib';
export const queueName = 'releaseguard.evaluate';
export async function broker() {
  const connection = await amqp.connect(process.env.AMQP_URL ?? '');
  connection.on('error', e => console.error(JSON.stringify({ event: 'broker_error', error: e.message })));
  // Exit on connection loss: the orchestrator restarts the process; unacked work is requeued.
  connection.on('close', () => process.exit(1));
  const channel = await connection.createConfirmChannel();
  await channel.assertQueue(queueName, { durable: true });
  return { connection, channel };
}

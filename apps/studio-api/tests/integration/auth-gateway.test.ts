import { resolve } from 'node:path';
import { isIP } from 'node:net';
import { expect, it } from 'vitest';
import { GenericContainer, Network, Wait, type StartedTestContainer } from 'testcontainers';

it('shipped nginx overwrites caller-supplied client identity before forwarding to the API', async () => {
  const network = await new Network().start();
  let upstream: StartedTestContainer | undefined;
  let gateway: StartedTestContainer | undefined;
  try {
    upstream = await new GenericContainer('node:22-alpine').withNetwork(network).withNetworkAliases('studio-api')
      .withExposedPorts(3001).withCommand(['node','-e',
        "require('http').createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({client_ip:req.headers['x-sda-client-ip']}))}).listen(3001,'0.0.0.0')"])
      .withWaitStrategy(Wait.forListeningPorts()).start();
    gateway = await new GenericContainer('nginx:1.28-alpine').withNetwork(network).withExposedPorts(80)
      .withCopyFilesToContainer([{source:resolve(__dirname,'../../../../infra/nginx/default.conf'),target:'/etc/nginx/conf.d/default.conf'}])
      .withWaitStrategy(Wait.forHttp('/api/v1/auth/register',80).forStatusCode(200)).start();
    const response = await fetch(`http://${gateway.getHost()}:${gateway.getMappedPort(80)}/api/v1/auth/register`,{
      headers:{'x-sda-client-ip':'203.0.113.42','x-forwarded-for':'203.0.113.42'},
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(isIP(body.client_ip)).toBeGreaterThan(0);
    expect(body.client_ip).not.toBe('203.0.113.42');
  } finally {
    await gateway?.stop(); await upstream?.stop(); await network.stop();
  }
});

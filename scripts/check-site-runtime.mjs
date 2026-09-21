import { preview } from 'vite';
import { verifySiteHttp } from './site-runtime.mjs';

let server;
try {
  let origin = process.env.SITE_RUNTIME_URL;
  if (!origin) {
    server = await preview({
      configFile: false,
      base: '/lumina-sheets/',
      preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
    });
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Preview has no TCP address');
    origin = `http://127.0.0.1:${address.port}`;
  }
  console.log(JSON.stringify(await verifySiteHttp('dist', origin)));
} finally {
  if (server)
    await new Promise((resolve, reject) => {
      server.httpServer.close((error) => (error ? reject(error) : resolve()));
      server.httpServer.closeAllConnections();
    });
}

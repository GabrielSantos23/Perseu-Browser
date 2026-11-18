const [ws, expr] = process.argv.slice(2);
const s = new WebSocket(ws);
s.onopen = () => s.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{expression:expr, awaitPromise:true, returnByValue:true}}));
s.onmessage = e => { const m = JSON.parse(e.data); if (m.id===1) { console.log(JSON.stringify(m.result.result?.value ?? m.result, null, 1)); s.close(); } };

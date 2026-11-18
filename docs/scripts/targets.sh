# Prints the DevTools URL of the first target whose URL contains $1.
curl -s http://127.0.0.1:9333/json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d).find(t=>t.url.includes(process.argv[1]));console.log(t?t.webSocketDebuggerUrl:'')})" "$1"

// The panda chat box in the browser (served at /helper.js, main site only).
// It asks POST /api/help, which answers from help.ts: no AI, nothing stored.
// A question with no answer goes to the contact form through sessionStorage,
// never the URL. Builds its own elements with textContent, so nothing typed or
// returned is ever parsed as HTML.
export function helperScript(starters: { id: string; q: string }[]): string {
  return COUNT + `(function(){
var KEY='sv_contact_question',STARTERS=${JSON.stringify(starters).replace(/</g, "\\u003c")};
function fill(){var t=document.getElementById('c-message'),q=null;if(!t)return false;try{q=sessionStorage.getItem(KEY);if(q)sessionStorage.removeItem(KEY)}catch(e){}
if(q){t.value=t.value?t.value+'\\n\\n'+q:q;var s=document.getElementById('c-subject');if(s&&!s.value)s.value='Question from the SiteVault helper'}return true}
fill();
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
var st=el('style');st.textContent='.svh-open{position:fixed;right:16px;bottom:16px;z-index:60;width:56px;height:56px;padding:0;border-radius:50%;border:2px solid var(--accent);background:#fdeed6;overflow:hidden;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.5)}.svh-open img{display:block;width:100%;height:100%}.svh[hidden],.svh-open[hidden]{display:none}.svh{padding:0;margin:0;position:fixed;right:16px;bottom:16px;z-index:61;width:24rem;max-width:calc(100vw - 16px);height:34rem;max-height:calc(100dvh - 16px);display:flex;flex-direction:column;background:#09090b;border:1px solid var(--line2);border-radius:16px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.7);font-size:.9rem}@media (max-width:480px){.svh{right:8px;left:8px;bottom:8px;width:auto}}.svh-head{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);background:rgba(56,189,248,.1)}.svh-head img{width:40px;height:40px;border-radius:50%}.svh-head div{flex:1}.svh-head b{display:block}.svh-head small{color:var(--muted)}.svh-x{background:none;border:0;color:var(--fg2);font-size:1.4rem;min-width:44px;min-height:44px;cursor:pointer}.svh-log{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:16px;display:flex;flex-direction:column;gap:10px;align-items:flex-start}.svh-b{max-width:88%;background:rgba(255,255,255,.1);border-radius:16px 16px 16px 4px;padding:8px 12px;margin:0;line-height:1.5}.svh-b strong{display:block;color:var(--accent-hi);font-size:.8rem;margin-bottom:4px}.svh-me{align-self:flex-end;max-width:85%;background:var(--accent);color:var(--on-accent);border-radius:16px 16px 4px 16px;padding:8px 12px;margin:0;overflow-wrap:anywhere}.svh-row{display:flex;flex-wrap:wrap;gap:8px}.svh-chip,.svh-go{font:inherit;font-size:.8rem;border-radius:999px;padding:8px 12px;min-height:36px;text-align:left;cursor:pointer;text-decoration:none}.svh-chip{background:none;border:1px solid var(--accent);color:var(--accent-hi)}.svh-go{background:var(--accent);border:0;color:var(--on-accent);font-weight:600}.svh-ask{background:none;border:0;padding:4px 0;min-height:32px;font:inherit;font-size:.8rem;color:var(--muted);text-decoration:underline;cursor:pointer}.svh-form{display:flex;gap:8px;padding:12px;border-top:1px solid var(--line)}.svh-form input{flex:1;min-width:0;font-size:16px}.svh-form button{flex-shrink:0}footer{padding-bottom:96px}';
document.head.appendChild(st);
var open=el('button','svh-open');open.type='button';open.setAttribute('aria-label','Ask the SiteVault panda');var im=el('img');im.src='/panda-helper.webp';im.alt='';open.appendChild(im);
var box=el('section','svh');box.hidden=true;box.setAttribute('role','dialog');box.setAttribute('aria-label','SiteVault helper');
var head=el('div','svh-head'),im2=el('img');im2.src='/panda-helper.webp';im2.alt='';var t=el('div');t.appendChild(el('b','','SiteVault helper'));t.appendChild(el('small','','Automatic answers about SiteVault'));var x=el('button','svh-x','\\u00d7');x.type='button';x.setAttribute('aria-label','Close');head.appendChild(im2);head.appendChild(t);head.appendChild(x);
var log=el('div','svh-log');log.setAttribute('aria-live','polite');log.appendChild(el('p','svh-b','Hi! Ask me how SiteVault works, or pick a question.'));
var form=el('form','svh-form'),inp=el('input');inp.type='text';inp.maxLength=300;inp.setAttribute('aria-label','Your question');inp.placeholder='Type your question';var go=el('button','btn small','Ask');go.type='submit';form.appendChild(inp);form.appendChild(go);
box.appendChild(head);box.appendChild(log);box.appendChild(form);document.body.appendChild(open);document.body.appendChild(box);
function chips(list){var r=el('div','svh-row');list.forEach(function(c){var b=el('button','svh-chip',c.q);b.type='button';b.onclick=function(){ask(c.q,c.id)};r.appendChild(b)});return r}
var first=chips(STARTERS);log.appendChild(first);
function contact(q){try{sessionStorage.setItem(KEY,q)}catch(e){}if(fill()){close();document.getElementById('c-message').focus()}else location.href='/contact'}
function send(q,label,cls){var b=el('button',cls,label);b.type='button';b.onclick=function(){contact(q)};return b}
function ask(q,id){q=q.trim().slice(0,300);if(!q)return;inp.value='';first.hidden=true;first.style.display='none';var me=el('p','svh-me',q);log.appendChild(me);me.scrollIntoView({block:'start'});
fetch('/api/help',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(id?{id:id}:{q:q})}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(d){
if(d.topic){var p=el('p','svh-b');p.appendChild(el('strong','',d.topic.q));p.appendChild(document.createTextNode(d.topic.a));log.appendChild(p);
if(d.topic.links.length){var r=el('div','svh-row');d.topic.links.forEach(function(l){var a=el('a','svh-go',l.label);a.href=l.href;r.appendChild(a)});log.appendChild(r)}
if(d.more.length)log.appendChild(chips(d.more));log.appendChild(send(q,'Not what you asked? Send it to us','svh-ask'))}
else{log.appendChild(el('p','svh-b',"I don't have an answer to that. Send it to our team and we'll reply by email."));log.appendChild(send(q,'Send my question','svh-go'))}
}).catch(function(){log.appendChild(el('p','svh-b',"I couldn't look that up just now."));log.appendChild(send(q,'Send my question','svh-go'))}).then(function(){me.scrollIntoView({block:'start'})})}
function close(){box.hidden=true;open.hidden=false;open.focus()}
open.onclick=function(){box.hidden=false;open.hidden=true;inp.focus()};x.onclick=close;
box.addEventListener('keydown',function(e){if(e.key==='Escape')close()});
form.addEventListener('submit',function(e){e.preventDefault();ask(inp.value)});
})();`;
}

// Our own visit counter (2026-11-25): one to a daily total in 3pandalabs/admin
// visits/ (admin.3pandalabs.com > Visitors). No cookie, no visitor id; only the
// referring host, utm tags and the first path segment leave the page, so an edit
// key or slug never does. The privacy page describes it: change both together.
const COUNT = `(function(){try{var l=location;if(l.hostname!=='sitevault.3pandalabs.com')return;var u=new URLSearchParams(l.search),n=u.get('nocount');
try{if(n==='1')localStorage.setItem('nocount','1');if(n==='0')localStorage.removeItem('nocount');if(localStorage.getItem('nocount')==='1')return}catch(e){}
var h='';try{h=document.referrer?new URL(document.referrer).hostname:''}catch(e){}
var t=(performance.getEntriesByType('navigation')[0]||{}).type;
navigator.sendBeacon('https://counts.3pandalabs.com/c',JSON.stringify({v:t==='reload'||t==='back_forward'?0:1,h:h,s:u.get('utm_source')||'',m:u.get('utm_medium')||'',g:u.has('gclid')||u.has('gbraid')||u.has('wbraid')?1:0,p:'/'+(l.pathname.split('/')[1]||'')}))}catch(e){}})();
`;

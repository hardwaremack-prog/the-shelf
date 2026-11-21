// "Make room" promo + drop-in shrinker for The Shelf's web pages (the installer/tour site and the board flashers).
// Put <div id="shrinkPromo" data-where="on your microSD card"></div> in the page, then load shrink.js, photo.js,
// zip.js and this file. Music becomes Opus 48 kbps (tags and cover kept); photos become AVIF (2048 px).
function mountShrinkPromo(box){
 box=box||document.getElementById('shrinkPromo');if(!box||box.dataset.mounted)return;box.dataset.mounted='1';
 var where=box.getAttribute('data-where')||'on The Shelf';
 var css=document.createElement('style');
 css.textContent=[
  '#shrinkPromo{--sp-ink:var(--ink,#1B1424);--sp-surf:var(--surface,#322542);--sp-text:var(--text,#F0E9E3);--sp-muted:var(--text-muted,#B7ABBA);--sp-acc:var(--accent,#F2B441);--sp-good:var(--mint,#6FCF97);--sp-line:var(--divider,#4A3B5C);color:var(--sp-text)}',
  '#shrinkPromo .sp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin:12px 0}',
  '#shrinkPromo .sp-card{background:var(--sp-surf);border:1px solid var(--sp-line);border-radius:14px;padding:16px 18px}',
  '#shrinkPromo .sp-tag{display:inline-block;font-size:12px;font-weight:700;color:#2A1D0E;background:var(--sp-acc);border-radius:999px;padding:2px 9px;margin-bottom:6px}',
  '#shrinkPromo h3{margin:4px 0 10px;font-size:17px}',
  '#shrinkPromo .sp-ba{display:grid;grid-template-columns:175px 1fr 74px;gap:10px;align-items:center;font-size:14px;margin:7px 0}',
  '#shrinkPromo .sp-ba span{color:var(--sp-muted)}#shrinkPromo .sp-ba b{text-align:right;font-variant-numeric:tabular-nums}',
  '#shrinkPromo .sp-bar{height:12px;background:var(--sp-ink);border-radius:999px;overflow:hidden}',
  '#shrinkPromo .sp-bar div{height:100%;background:#8aa0b8;border-radius:999px}#shrinkPromo .sp-bar div.go{background:var(--sp-good)}',
  '#shrinkPromo .sp-big{font-size:28px;font-weight:800;color:var(--sp-good);margin:8px 0 2px}',
  '#shrinkPromo small,#shrinkPromo .sp-muted{color:var(--sp-muted);font-size:13px}',
  '#shrinkPromo .sp-drop{border:2px dashed var(--sp-line);border-radius:14px;padding:26px;text-align:center;color:var(--sp-muted);font-size:16px;cursor:pointer}',
  '#shrinkPromo .sp-drop.on{border-color:var(--sp-acc);color:var(--sp-acc)}',
  '#shrinkPromo table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13.5px}',
  '#shrinkPromo th,#shrinkPromo td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--sp-line)}',
  '#shrinkPromo td a{color:var(--sp-acc)}#shrinkPromo td:nth-child(n+2){white-space:nowrap}',
  '#shrinkPromo button{margin-top:10px;background:var(--sp-acc);color:#2A1D0E;border:0;border-radius:999px;padding:9px 18px;font-weight:700;cursor:pointer}',
  '@media(max-width:520px){#shrinkPromo .sp-ba{grid-template-columns:110px 1fr 64px}}'
 ].join('\n');
 if(!document.getElementById('spCss')){css.id='spCss';document.head.appendChild(css);}
 box.innerHTML=
  '<div class="sp-grid">'+
   '<div class="sp-card"><span class="sp-tag">Music</span><h3>A 4-minute song</h3>'+
    '<div class="sp-ba"><span>Before: MP3, 128 kbps</span><div class="sp-bar"><div style="width:100%"></div></div><b>3.8 MB</b></div>'+
    '<div class="sp-ba"><span>After: Opus, 48 kbps</span><div class="sp-bar"><div class="go" style="width:37%"></div></div><b>1.4 MB</b></div>'+
    '<div class="sp-big">62% smaller</div>'+
    '<small>Same song to most ears, with its title, artist, album and cover art kept. On a 32 GB card: about 8,400 songs as MP3, about 22,800 shrunk.</small></div>'+
   '<div class="sp-card"><span class="sp-tag">Photos</span><h3>A 12-megapixel phone photo</h3>'+
    '<div class="sp-ba"><span>Before: JPEG or iPhone HEIC</span><div class="sp-bar"><div style="width:100%"></div></div><b>~3.5 MB</b></div>'+
    '<div class="sp-ba"><span>After: AVIF, 2048 px</span><div class="sp-bar"><div class="go" style="width:7%"></div></div><b>~250 KB</b></div>'+
    '<div class="sp-big">about 93% smaller</div>'+
    '<small>Still sharper than most screens show it. 2048 px is a full-screen picture on a laptop or TV. About 14 photos fit where 1 used to.</small></div>'+
  '</div>'+
  '<div class="sp-card">'+
   '<b>Try it on your own files.</b> <span class="sp-muted">Drop MP3s and photos below. They\'re shrunk right here in your browser, so nothing is uploaded anywhere. '+
   'Then put the shrunk files '+where+'. (Uploading through The Shelf\'s own page shrinks them automatically, too.)</span>'+
   '<div class="sp-drop" id="spDrop" style="margin-top:12px">Drop MP3s and photos here, or click to choose<input type="file" id="spPick" multiple accept="audio/*,image/*,.heic,.heif,.mp3,.m4a,.flac,.wav,.ogg" hidden></div>'+
   '<table id="spList" hidden><tr><th>File</th><th>Before</th><th>After</th><th>Saved</th><th></th></tr></table>'+
   '<div id="spTotal" class="sp-muted" style="margin-top:8px"></div>'+
   '<button id="spZip" hidden>Download all (.zip)</button>'+
  '</div>';
 var done=[],q=Promise.resolve(),tB=0,tA=0,$=function(i){return document.getElementById(i);};
 var kb=function(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';};
 function one(f){
  var tr=document.createElement('tr');tr.innerHTML='<td></td><td></td><td>working...</td><td></td><td></td>';
  tr.cells[0].textContent=f.name;tr.cells[1].textContent=kb(f.size);$('spList').appendChild(tr);$('spList').hidden=false;
  var job=canShrink(f)?shrinkAudio(f,function(p){tr.cells[2].textContent=p+'%';})
         :(isPhoto(f)&&!/\.(gif|svg)$/i.test(f.name))?shrinkPhoto(f,'avif',2048)
         :Promise.reject(new Error('not music or a photo'));
  return job.then(function(o){return o.arrayBuffer().then(function(ab){
   done.push({name:o.name,data:new Uint8Array(ab)});tB+=f.size;tA+=o.size;
   if(o.name!=f.name)tr.cells[0].textContent=f.name+'  →  '+o.name;
   tr.cells[2].textContent=kb(o.size);
   tr.cells[3].innerHTML='<b style="color:var(--sp-good)">'+Math.max(0,Math.round(100-o.size*100/f.size))+'%</b>';
   var a=document.createElement('a');a.textContent='Save';a.href=URL.createObjectURL(o);a.download=o.name;tr.cells[4].appendChild(a);
   $('spTotal').innerHTML='Before: <b>'+kb(tB)+'</b> &nbsp; After: <b>'+kb(tA)+'</b> &nbsp; <b style="color:var(--sp-good)">'+Math.round(100-tA*100/tB)+'% smaller</b>';
   $('spZip').hidden=false;});
  }).catch(function(e){tr.cells[2].textContent='skipped';var m=(e&&e.message)||'';tr.cells[3].textContent=/fetch|import|load/i.test(m)?'couldn\'t load the encoder (it needs the internet the first time)':m;});
 }
 function add(list){[].slice.call(list).forEach(function(f){q=q.then(function(){return one(f);});});}
 var dz=$('spDrop');
 dz.addEventListener('click',function(e){if(e.target===dz)$('spPick').click();});
 dz.addEventListener('dragover',function(e){e.preventDefault();dz.classList.add('on');});
 dz.addEventListener('dragleave',function(){dz.classList.remove('on');});
 dz.addEventListener('drop',function(e){e.preventDefault();dz.classList.remove('on');add(e.dataTransfer.files);});
 $('spPick').onchange=function(){add(this.files);this.value='';};
 $('spZip').onclick=function(){var a=document.createElement('a');a.href=URL.createObjectURL(makeZip(done));a.download='shrunk-for-the-shelf.zip';a.click();};
}
mountShrinkPromo();

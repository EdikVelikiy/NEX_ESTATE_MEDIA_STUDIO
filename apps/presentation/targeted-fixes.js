/* Targeted Presentation Studio fixes, 2026-09-18. Shared preview/export geometry. */
(() => {
  'use strict';
  const clamp = (value, fallback = 50) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : fallback;
  function brokerGeometry(image, w, h, meta = {}) {
    const iw = image.naturalWidth || image.width || 1, ih = image.naturalHeight || image.height || 1;
    const cover = Math.max(w / iw, h / ih);
    // Fit all four corners inside the circular contact frame, keeping old cover-relative zoom.
    const minScale = Math.min(w, h) / Math.hypot(iw, ih) / cover;
    const scale = Math.max(minScale, Number(meta.scale) || 1), width = iw * cover * scale, height = ih * cover * scale;
    return { width, height, minScale, scale, x: (w - width) * (width<=w?0.5:clamp(meta.focusX)/100), y: (h - height) * (height<=h?0.5:clamp(meta.focusY)/100) };
  }
  function paintBroker(image, meta) {
    const parent = image?.parentElement;
    if (!parent || !image.naturalWidth) return null;
    const w = parent.clientWidth, h = parent.clientHeight, g = brokerGeometry(image, w, h, meta);
    parent.style.position = 'relative';
    for (const [key, value] of Object.entries({position:'absolute',width:g.width+'px',height:g.height+'px',left:g.x+'px',top:g.y+'px',maxWidth:'none',maxHeight:'none',transform:'none',objectFit:'fill',objectPosition:'center',margin:'0'})) image.style.setProperty(key.replace(/[A-Z]/g, c=>'-'+c.toLowerCase()), value, 'important');
    return g;
  }
  function drawBroker(ctx, image, x, y, w, h, meta, background) {
    const g = brokerGeometry(image, w, h, meta);
    ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.fillStyle=background;ctx.fillRect(x,y,w,h);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,x+g.x,y+g.y,g.width,g.height);ctx.restore();
  }
  function lineName(row) {
    // Only the structured line label is changed; station names and travel times stay intact.
    const name = String(row.lineName || '').trim();
    if (/^МЦД[-\s]*\d+$/iu.test(name)) return 'Московские центральные диаметры';
    return name || ({metro:'Метро',mcc:'Московское центральное кольцо',mcd:'Московские центральные диаметры',monorail:'Монорельс'}[row.system] || 'Линия');
  }
  let originalFocus = null;
  function coverGeometry(geometry) {
    const registry=window.NEXESTATE_STAGE2_TEST?.focusRegistry?.byNexEstate;
    if(!registry)return;
    const fields={studioName:'titleRect',studioUse:'purposeRect',studioAddr:'addressRect',studioMetro:'metroRect',studioDescription:'descriptionRect'};
    if(!originalFocus)originalFocus=Object.fromEntries(Object.keys(fields).map(key=>[key,registry[key]?.rect?.slice()]));
    for(const [key,rectKey] of Object.entries(fields))if(registry[key]){
      const rect=geometry?.[rectKey];registry[key].rect=rect?[rect.x/12.4,rect.y/17.54,rect.w/12.4,rect.h/17.54]:(originalFocus[key]||registry[key].rect);
    }
  }
  function drawCover(api, model, entries, p, themeKey, total, helpers) {
    const {data,branded,logo,stations,label,marker,glyph,clearAddress}=helpers;
    const c=api.newCanvas(api.W,api.H),ctx=c.getContext('2d');api.reset(ctx);
    ctx.fillStyle=p.paper;ctx.fillRect(0,0,api.W,api.H);api.drawWave(ctx,0,0,560,1320,p.accent);api.drawPhotoGrid(ctx,p,entries);
    const brandBox=branded?logo(ctx,30,30,90,p.accent,'full'):null;
    const family=api.fontStack(),fit=(text,width,size,weight=600,ratio=1.2,height=100000,min=size)=>window.NEXESTATE_TEXT_LAYOUT_R88.fit(ctx,text,width,height,{family,weight,max:size,min,ratio});
    const draw=(layout,x,y,color)=>{ctx.save();ctx.textBaseline='top';api.drawLines(ctx,layout,x,y,color);ctx.restore();};
    const title=String(data.objName||'').trim(),purpose=String(data.use||'').trim(),scenario=String(data.scenario||'').trim(),address=clearAddress?'':String(data.addr||'').trim(),description=String(data.draft??'');
    const purposeFit=fit(purpose,432,21,600),titleFit=fit(title,432,purposeFit.size*2,700,1.1,340,32),addressFit=fit(address,382,22),metroRows=stations(data),metroFits=metroRows.map(row=>fit(label(row),340,19,600,1.2));
    const titleH=title?titleFit.height+24:0,purposeH=purpose?22+purposeFit.height+28:0,addressH=address?Math.max(58,addressFit.height+18):0,metroH=metroFits.reduce((sum,item)=>sum+Math.max(48,item.height+16),0);
    const descriptionBottom=1252,preferredTop=210,minTop=brandBox?Math.max(132,brandBox.y+brandBox.h+30):70,identityH=(scenario?34:0)+titleH+purposeH+addressH+metroH+28+40;
    const descMin=fit(description,430,16,500,1.28);
    // Use all the lower space first, then release only the unused space above the title.
    const contentTop=Math.max(minTop,preferredTop-Math.max(0,preferredTop+identityH+descMin.height-descriptionBottom));
    let y=contentTop;
    if(scenario){draw(fit(scenario.toLocaleUpperCase('ru-RU'),432,17,700),64,y,p.muted);y+=34;}
    const titleRect={x:64,y,w:432,h:title?titleFit.height:0};if(title){draw(titleFit,64,y,p.text);y+=titleH;}
    const purposeRect={x:64,y,w:432,h:purpose?22+purposeFit.height:0};if(purpose){draw(fit('НАЗНАЧЕНИЕ',432,14,700),64,y,p.accent);draw(purposeFit,64,y+22,p.muted);y+=purposeH;}
    ctx.fillStyle=p.accent;ctx.fillRect(64,y-14,68,3);
    const addressRect={x:64,y,w:432,h:addressH};if(address){api.drawLocation(ctx,64,y,p.accent,false);draw(addressFit,106,y+10,p.text);y+=addressH;}
    const metroRects=[],metroColors=[];const metroTop=y;
    metroRows.forEach((station,index)=>{const mark=marker(ctx,64,y,station,{...p,dark:p.paper,inverse:p.text});glyph(ctx,104,y+4,station,mark.colors[0]);draw(metroFits[index],126,y+10,p.muted);const height=Math.max(48,metroFits[index].height+16);metroRects.push({x:64,y,w:432,h:height});metroColors.push({station:station.name,colors:mark.colors});y+=height;});
    const descriptionTop=y+28,descriptionTextTop=descriptionTop+40,available=Math.max(0,descriptionBottom-descriptionTextTop);
    draw(fit('ОПИСАНИЕ',430,17,700),64,descriptionTop,p.accent);ctx.fillStyle=p.accent;ctx.fillRect(64,descriptionTop+24,48,3);
    const descriptionFit=fit(description,430,18,500,1.28,available,16);
    ctx.save();ctx.beginPath();ctx.rect(64,descriptionTextTop,430,available);ctx.clip();draw(descriptionFit,64,descriptionTextTop,p.muted);ctx.restore();
    const features=api.selectedFeatures();ctx.fillStyle=p.surface2;ctx.fillRect(0,1320,api.W,api.H-1320);ctx.fillStyle=p.accent;ctx.fillRect(0,1320,api.W,5);ctx.textBaseline='alphabetic';features.forEach((item,index)=>api.drawFeatureCard(ctx,p,item,index));
    draw(fit('01 / '+String(total).padStart(2,'0'),432,13,600),64,1284,p.muted);
    const geometry={slideRect:{x:0,y:0,w:api.W,h:api.H},brandColumnRect:{x:0,y:0,w:560,h:1320},logoRect:brandBox||null,titleRect,purposeRect,addressRect,metroRects,metroRect:{x:64,y:metroTop,w:432,h:metroH},descriptionRect:{x:64,y:descriptionTop,w:430,h:Math.max(0,descriptionBottom-descriptionTop)},photoRect:{x:560,y:0,w:680,h:1320}};
    Object.assign(c,{neStage4Kind:'cover',neStage3PageKind:'cover',neBrandTheme:themeKey,neBrandLayout:api.layout,neStage4FeatureCount:features.length,neStage4PhotoCount:entries.length,neStage4PlanSlots:entries.flatMap((entry,index)=>entry?.isPlan?[index]:[]),neTitleMetrics:{fits:titleFit.fits,truncated:false,lines:titleFit.allLines,fontSize:titleFit.size},nePurpose:purpose,neTargetedPurposeSize:purposeFit.size,neRenderedIdentity:{scenario,title,purpose,address,description,descriptionHeadingCount:1,descriptionContinues:!descriptionFit.fits},ne88DescriptionMetrics:descriptionFit,neDescriptionContinues:!descriptionFit.fits,ne88MetroFits:y<=descriptionBottom-90,neMetroStations:metroRows.map(label),neMetroMarkerColors:metroColors,neAppBrandBoxes:brandBox?[brandBox]:[],neCoverBrandLogo:brandBox?{rect:brandBox,composition:['NEX','ESTATE','skyline'],parent:'brandColumnRect',asset:'./assets/nexestate-logo-reference-clean.png'}:null,neHotfixGeometry:geometry});
    coverGeometry(geometry);return c;
  }
  const defaultHeadline='Организуем показ и предоставим документы по объекту';
  function contactValue(settings,key,fallback){return Object.hasOwn(settings||{},key)?String(settings[key]??''):fallback;}
  function drawContactCopy(api,ctx,p,settings,location){
    const headline=contactValue(settings,'contactHeadline',defaultHeadline),address=contactValue(settings,'contactAddress',location);
    if(p.accent!=='#527A59'&&!Object.hasOwn(settings,'contactHeadline')&&!Object.hasOwn(settings,'contactAddress')){api.fitAndDraw(ctx,headline,104,330,820,260,52,32,'700',p.inverse,1.12,6);if(address)api.fitAndDraw(ctx,address,104,632,930,70,23,16,'600',p.inverseMuted,1.18,3);return;}
    const fit=(text,w,h,max,min)=>window.NEXESTATE_TEXT_LAYOUT_R88.fit(ctx,text,w,h,{family:api.fontStack(),weight:600,max,min,ratio:1.18});
    const head=fit(headline,930,270,48,26),body=fit(address,930,118,23,16);
    ctx.save();ctx.textBaseline='top';api.drawLines(ctx,head,104,290,p.inverse);api.drawLines(ctx,body,104,578,p.inverseMuted);ctx.restore();
    ctx.canvas.neTargetedContact={headline,address,headlineFits:head.fits,addressFits:body.fits};
  }
  const api={brokerGeometry,paintBroker,drawBroker,lineName,coverGeometry,drawCover,drawContactCopy};window.NEXESTATE_TARGETED_FIXES=api;
  window.NEXESTATE_RUN_INTERNAL_EXTENSION('('+function targetedRuntime(){
    const api=window.NEXESTATE_TARGETED_FIXES,defaultHeadline='Организуем показ и предоставим документы по объекту';
    api.syncContact=function(){
      const host=byId('studioMgr')?.closest('details');if(!host||!currentSettings)return;
      let block=byId('neTargetedContactCopy');
      if(!block){block=document.createElement('div');block.id='neTargetedContactCopy';block.style.cssText='display:grid;gap:10px;margin:12px 0';
        for(const [key,title] of [['contactHeadline','Заголовок страницы контактов'],['contactAddress','Текст или адрес под заголовком']]){const label=document.createElement('label'),input=document.createElement('textarea');input.id='neTargeted'+key;input.dataset.contactCopy=key;input.rows=3;input.style.cssText='width:100%;box-sizing:border-box;white-space:pre-wrap';label.textContent=title;label.appendChild(input);block.appendChild(label);input.oninput=()=>{if(!currentSettings)return;historyPoint('Текст страницы контактов');currentSettings[key]=input.value;scheduleSave();scheduleRender();};}
        host.appendChild(block);
      }
      const data=currentRecord?.data||{},bridge=window.NEXESTATE_DATA_RENDER_BRIDGE,stations=bridge.normalizeMetroStations(data.metroStations?.length?data.metroStations:data.metro),fallback=[bridge.manualClear('addr')?'':bridge.clean(data.addr,220),bridge.firstMetro(stations)].filter(Boolean).join(' · ');
      for(const input of block.querySelectorAll('textarea'))if(document.activeElement!==input){const key=input.dataset.contactCopy;input.value=Object.hasOwn(currentSettings,key)?String(currentSettings[key]??''):(key==='contactHeadline'?defaultHeadline:fallback);}
    };
    document.addEventListener('nexestate:project-restored',()=>requestAnimationFrame(api.syncContact));
    const previous=renderBrokerEditorMeta;renderBrokerEditorMeta=function(){const result=previous.apply(this,arguments);const image=byId('studioBrokerPhotoPreview')?.querySelector('img');if(image)api.paintBroker(image,currentSettings?.broker||{});return result;};
    document.fonts?.addEventListener('loadingdone',()=>{if(currentRecord)scheduleRender();});
    api.syncContact();
  }.toString()+')()');

  // Share edge scrolling between the existing native and pointer-based media drags.
  let drag=null,frame=0,last=0;
  function stop(cancelPointer=false){
    const previous=drag;cancelAnimationFrame(frame);frame=0;drag=null;last=0;
    if(cancelPointer&&previous?.pointerId!=null)previous.source.dispatchEvent(new PointerEvent('pointercancel',{pointerId:previous.pointerId,bubbles:true}));
  }
  function tick(time){
    if(!drag||!drag.panel.isConnected||document.hidden||!document.querySelector('#presentationStudio.show')||window.NE53_STATE?.step!=='media'){stop(true);return;}
    const r=drag.panel.getBoundingClientRect(),edge=Math.min(80,r.height/3),y=drag.y;
    const amount=!drag.inside?0:y<r.top+edge?-Math.min(1,(r.top+edge-y)/edge):y>r.bottom-edge?Math.min(1,(y-r.bottom+edge)/edge):0;
    drag.panel.scrollTop+=amount*Math.abs(amount)*650*Math.min(32,last?time-last:16)/1000;last=time;frame=requestAnimationFrame(tick);
  }
  function begin(event,pointerId){
    if(window.NE53_STATE?.step!=='media'||!event.target.closest?.('#presentationStudio .ne52-sidebar'))return;
    let panel=event.target.parentElement;
    while(panel&&panel!==document.body&&!(panel.scrollHeight>panel.clientHeight+2&&/auto|scroll/.test(getComputedStyle(panel).overflowY)))panel=panel.parentElement;
    if(!panel||panel===document.body||!panel.closest('#presentationStudio .ne52-sidebar'))return;
    stop();drag={panel,y:event.clientY,inside:true,source:event.target,pointerId};frame=requestAnimationFrame(tick);
  }
  function move(event){if(!drag)return;const r=drag.panel.getBoundingClientRect();drag.inside=event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;drag.y=event.clientY;}
  document.addEventListener('dragstart',event=>begin(event,null),true);
  document.addEventListener('dragover',move,true);
  document.addEventListener('dragleave',event=>{if(drag&&!event.relatedTarget){const r=drag.panel.getBoundingClientRect();if(event.clientX<=r.left||event.clientX>=r.right||event.clientY<=r.top||event.clientY>=r.bottom)drag.inside=false;}},true);
  document.addEventListener('pointerdown',event=>{if(event.button===0&&event.target.closest?.('.ne87-media-drag'))begin(event,event.pointerId);},true);
  document.addEventListener('pointermove',event=>{if(drag?.pointerId===event.pointerId)move(event);},true);
  for(const name of ['pointerup','pointercancel'])document.addEventListener(name,event=>{if(drag?.pointerId===event.pointerId)stop();},true);
  for(const name of ['drop','dragend'])document.addEventListener(name,()=>stop(),true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')stop(true);},true);
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-step]'))stop(true);},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop(true);});
})();

(() => {
  'use strict';

  const DB_NAME = 'wengao-blank-editor-v1';
  const DB_KEY = 'workspace';
  const LOCAL_KEY = 'wengao-blank-editor-fallback-v1';
  const isMobile = document.body.classList.contains('mobile');
  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const newId = () => crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emptyState = () => ({version:1, folders:[], documents:[]});
  let state = emptyState();
  let selected = 'all';
  let activeId = null;
  let editingId = null;
  let folderEditingId = null;
  let draft = null;
  let persistTimer = null;
  let saveQueue = Promise.resolve();
  let storageMode = 'indexeddb';
  let databasePromise = null;

  $('#app').innerHTML = `
    <header class="topbar">
      <button class="iconBtn mobileOnly" id="openMenu" aria-label="打开目录">☰</button>
      <div class="brand"><strong>空白文稿库</strong><span>自己的目录与文稿</span></div>
      <div class="topActions"><span id="saveState" class="saveState">准备就绪</span>
        <button id="newDocTop" class="primary">＋ 新建文稿</button></div>
    </header>
    <div class="shell">
      <div id="scrim" class="scrim"></div>
      <aside id="sidebar" class="sidebar" aria-label="目录与筛选">
        <div class="sideHead"><strong>目录与检索</strong><button id="closeMenu" class="iconBtn mobileOnly" aria-label="关闭目录">✕</button></div>
        <div class="sidebarScroll">
          <label class="searchLabel" for="search">搜索文稿</label>
          <input id="search" type="search" placeholder="标题、摘要、正文或标签" autocomplete="off">
          <div class="treeHead"><span>我的目录</span><button id="addRoot" class="textBtn">＋ 新目录</button></div>
          <nav id="folderTree" class="folderTree" aria-label="文稿目录"></nav>
          <button id="manageFolders" class="manageBtn">管理目录与顺序</button>
        </div>
        <div class="sideFoot">
          <button id="exportData">导出备份</button><button id="importData">导入备份</button>
          <input id="importFile" type="file" accept=".json,application/json" hidden>
          <a href="${isMobile ? 'desktop' : 'mobile'}.html" class="switchView">切换到${isMobile ? '桌面版' : '手机版'}</a>
          <p>文稿保存在当前浏览器。换设备或清理浏览器前，请先导出备份。</p>
        </div>
        <div id="closeEdge" class="closeEdge" aria-hidden="true"></div>
      </aside>
      <main class="main">
        <div class="listHeader"><div><div class="eyebrow">文稿目录</div><h1 id="viewTitle">全部文稿</h1>
          <p id="viewCount">0 篇文稿</p></div>
          <label class="sortWrap">排序 <select id="sort"><option value="recent">最近编辑</option>
            <option value="created">最早创建</option><option value="title">标题</option></select></label></div>
        <div id="docList" class="docList"></div>
      </main>
    </div>
    <div id="openEdge" class="openEdge mobileOnly" aria-hidden="true"></div>
    <section id="reader" class="overlay reader" aria-label="阅读文稿" aria-hidden="true">
      <div class="readerPanel"><div class="overlayHead"><button id="closeReader" class="iconBtn">← 返回</button>
        <span class="overlayTitle">阅读文稿</span><button id="editFromReader" class="outline">编辑</button></div>
        <article id="readerBody" class="readerBody"></article></div>
      <div id="readerEdge" class="readerEdge mobileOnly" aria-hidden="true"></div>
    </section>
    <section id="editor" class="overlay editor" aria-label="编辑文稿" aria-hidden="true">
      <div class="editorPanel"><div class="overlayHead"><button id="closeEditor" class="iconBtn">← 返回</button>
        <span class="overlayTitle" id="editorTitle">新建文稿</span><button id="saveDoc" class="primary">保存</button></div>
        <form id="docForm" class="editorForm"><label>标题<input id="docTitle" maxlength="180" placeholder="输入文稿标题"></label>
          <label>所在目录<select id="docFolder"></select></label>
          <label>目录页摘要（可留空）<textarea id="docSummary" rows="3" placeholder="留空则自动显示正文开头"></textarea></label>
          <label>标签（用逗号分隔）<input id="docTags" placeholder="例如：教育, 成长"></label>
          <label>正文<textarea id="docBody" class="bodyInput" placeholder="在这里写文稿……"></textarea></label>
          <div class="editorBottom"><span id="wordCount">0 字</span><button type="button" id="moveToTrash" class="danger">移入回收站</button></div>
        </form></div>
    </section>
    <section id="folderModal" class="overlay folderModal" aria-label="管理目录" aria-hidden="true">
      <div class="folderPanel"><div class="overlayHead"><button id="closeFolders" class="iconBtn">← 返回</button>
        <span class="overlayTitle">管理目录</span><button id="newFolderInModal" class="primary">＋ 新目录</button></div>
        <div class="folderPanelBody"><form id="folderForm" class="folderForm" hidden>
          <h2 id="folderFormTitle">新目录</h2><label>目录名称<input id="folderName" maxlength="70" required placeholder="例如：亲子教育"></label>
          <label>上级目录<select id="folderParent"></select></label>
          <div class="formActions"><button type="button" id="cancelFolder" class="outline">取消</button>
            <button type="submit" class="primary">保存目录</button></div></form>
          <div id="folderManageList"></div></div></div>
    </section>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>`;

  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
  }
  function setSaveState(message) { $('#saveState').textContent = message; }
  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB 不可用')); return; }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return databasePromise;
  }
  async function readStored() {
    try {
      const db = await openDatabase();
      return await new Promise((resolve, reject) => {
        const request = db.transaction('state').objectStore('state').get(DB_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (_) {
      storageMode = 'localstorage';
      try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); }
      catch (_) { storageMode = 'unavailable'; return null; }
    }
  }
  async function writeStored(snapshot) {
    if (storageMode === 'indexeddb') {
      try {
        const db = await openDatabase();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('state', 'readwrite');
          tx.objectStore('state').put(snapshot, DB_KEY);
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        });
        return;
      } catch (_) { storageMode = 'localstorage'; }
    }
    if (storageMode === 'localstorage') { localStorage.setItem(LOCAL_KEY, JSON.stringify(snapshot)); return; }
    throw new Error('浏览器无法保存数据，请导出备份');
  }
  function persistSoon() {
    setSaveState('保存中…'); clearTimeout(persistTimer);
    persistTimer = setTimeout(flushSave, 220);
  }
  function flushSave() {
    clearTimeout(persistTimer); persistTimer = null;
    const snapshot = structuredClone(state);
    saveQueue = saveQueue.catch(() => {}).then(() => writeStored(snapshot));
    saveQueue.then(() => setSaveState('已保存至本设备')).catch(error => {
      setSaveState('保存失败'); toast(error.message);
    });
    return saveQueue;
  }
  function cleanImported(input) {
    if (!input || !Array.isArray(input.folders) || !Array.isArray(input.documents))
      throw new Error('文件不是有效的文稿库备份');
    if (input.folders.length > 20000 || input.documents.length > 100000)
      throw new Error('备份条目过多');
    const seenFolder = new Set();
    const folders = input.folders.map(item => {
      const id = String(item.id || newId());
      if (seenFolder.has(id)) throw new Error('目录 ID 重复');
      seenFolder.add(id);
      return {id, name:String(item.name || '未命名目录').slice(0,70),
        parentId:item.parentId == null ? null : String(item.parentId), order:Number(item.order) || 0};
    });
    for (const folder of folders) {
      if (folder.parentId && !seenFolder.has(folder.parentId)) folder.parentId = null;
      const visited = new Set([folder.id]); let parent = folder.parentId;
      while (parent) {
        if (visited.has(parent)) throw new Error('备份中的目录出现循环');
        visited.add(parent); parent = folders.find(f => f.id === parent)?.parentId || null;
      }
    }
    const seenDoc = new Set();
    const documents = input.documents.map(item => {
      const id = String(item.id || newId());
      if (seenDoc.has(id)) throw new Error('文稿 ID 重复');
      seenDoc.add(id);
      return {id, title:String(item.title || ''), body:String(item.body || ''),
        summary:String(item.summary || ''), tags:Array.isArray(item.tags) ? item.tags.map(String) : [],
        folderId:seenFolder.has(String(item.folderId)) ? String(item.folderId) : null,
        createdAt:Number(item.createdAt) || Date.now(), updatedAt:Number(item.updatedAt) || Date.now(),
        deletedAt:Number(item.deletedAt) || null};
    });
    return {version:1, folders, documents};
  }
  function folderById(id) { return state.folders.find(folder => folder.id === id); }
  function folderChildren(parentId) {
    return state.folders.filter(folder => folder.parentId === parentId).sort((a,b) => a.order-b.order || a.name.localeCompare(b.name,'zh'));
  }
  function descendants(id) {
    const ids = new Set([id]);
    for (const child of state.folders.filter(folder => folder.parentId === id))
      for (const nested of descendants(child.id)) ids.add(nested);
    return ids;
  }
  function folderLabel(id) {
    const parts=[]; let current=folderById(id); const visited=new Set();
    while(current && !visited.has(current.id)) {
      visited.add(current.id); parts.unshift(current.name); current=folderById(current.parentId);
    }
    return parts.join(' / ');
  }
  function visibleDocs() {
    const query = $('#search').value.trim().toLowerCase();
    const folderIds = selected !== 'all' && selected !== 'none' && selected !== 'trash' ? descendants(selected) : null;
    const list = state.documents.filter(doc => {
      if (selected === 'trash') return !!doc.deletedAt;
      if (doc.deletedAt) return false;
      if (selected === 'none' && doc.folderId) return false;
      if (folderIds && !folderIds.has(doc.folderId)) return false;
      return !query || [doc.title, doc.summary, doc.body, ...doc.tags].some(s => String(s).toLowerCase().includes(query));
    });
    const sort = $('#sort').value;
    if (sort === 'title') list.sort((a,b) => a.title.localeCompare(b.title,'zh'));
    else if (sort === 'created') list.sort((a,b) => a.createdAt-b.createdAt);
    else list.sort((a,b) => b.updatedAt-a.updatedAt);
    return list;
  }
  function folderCount(id) {
    const ids = descendants(id);
    return state.documents.filter(doc => !doc.deletedAt && ids.has(doc.folderId)).length;
  }
  function renderTree() {
    const active = state.documents.filter(doc => !doc.deletedAt).length;
    const trash = state.documents.filter(doc => doc.deletedAt).length;
    const special = (id,label,count,icon) => `<button class="folderItem ${selected===id?'sel':''}" data-select="${id}">
      <span class="folderIcon">${icon}</span><span class="folderText">${label}</span><span class="folderCount">${count}</span></button>`;
    const folders = (parent,level=0) => folderChildren(parent).map(folder =>
      `<div class="folderRow" style="--depth:${Math.min(level,8)}"><button class="folderItem ${selected===folder.id?'sel':''}" data-select="${escapeHtml(folder.id)}">
        <span class="folderIcon">▸</span><span class="folderText">${escapeHtml(folder.name)}</span><span class="folderCount">${folderCount(folder.id)}</span></button>
        <button class="folderAdd" data-add-child="${escapeHtml(folder.id)}" title="添加子目录">＋</button></div>${folders(folder.id,level+1)}`
    ).join('');
    $('#folderTree').innerHTML = special('all','全部文稿',active,'▤') +
      folders(null) + special('none','未分类',state.documents.filter(d=>!d.deletedAt&&!d.folderId).length,'◇') +
      special('trash','回收站',trash,'♻');
  }
  function formatDate(timestamp) { return new Date(timestamp).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}); }
  function summaryFor(doc) { return doc.summary.trim() || doc.body.replace(/\s+/g,' ').trim().slice(0,110); }
  function renderList() {
    const label = ({all:'全部文稿',none:'未分类',trash:'回收站'})[selected] || folderLabel(selected) || '全部文稿';
    const docs = visibleDocs();
    $('#viewTitle').textContent = label;
    $('#viewCount').textContent = `${docs.length} 篇文稿`;
    if (!docs.length) {
      $('#docList').innerHTML = `<div class="empty"><div class="emptyIcon">▤</div><h2>${selected==='trash'?'回收站是空的':state.documents.length?'这里还没有文稿':'从空白开始整理你的文稿'}</h2>
        <p>${selected==='trash'?'移入回收站的文稿可以在这里恢复。':'先创建目录，或者直接新建一篇文稿。'}</p>
        ${selected==='trash'?'':'<button class="primary" data-action="new">＋ 新建文稿</button>'}</div>`;
      return;
    }
    $('#docList').innerHTML = docs.map(doc => `<button class="docCard" data-open="${escapeHtml(doc.id)}">
      <div class="docTitle">${escapeHtml(doc.title || '未命名文稿')}</div>
      <div class="docMeta"><span>${escapeHtml(doc.folderId ? folderLabel(doc.folderId) : '未分类')}</span>
        <span>${formatDate(doc.updatedAt)}</span><span>${doc.body.replace(/\s/g,'').length.toLocaleString()} 字</span></div>
      ${summaryFor(doc)?`<p class="docSummary">${escapeHtml(summaryFor(doc))}</p>`:''}
      ${doc.tags.length?`<div class="docTags">${doc.tags.map(tag=>`<span>#${escapeHtml(tag)}</span>`).join('')}</div>`:''}
      </button>`).join('');
  }
  function render() { renderTree(); renderList(); }
  function selectFolder(id) { selected=id; render(); closeSidebar(); }
  function openSidebar() { if(isMobile) document.body.classList.add('drawerOpen'); }
  function closeSidebar() { document.body.classList.remove('drawerOpen'); }
  function showOverlay(id) { $(id).classList.add('open'); $(id).setAttribute('aria-hidden','false'); document.body.classList.add('modalOpen'); }
  function hideOverlay(id) { $(id).classList.remove('open'); $(id).setAttribute('aria-hidden','true'); if(!document.querySelector('.overlay.open'))document.body.classList.remove('modalOpen'); }
  function openReader(id) {
    const doc=state.documents.find(item => item.id===id); if(!doc)return;
    activeId=id;
    const paragraphs=(doc.body || '（这篇文稿尚未填写正文）').split(/\n{2,}/).map(p=>p.trim()).filter(Boolean);
    $('#readerBody').innerHTML = `<h1>${escapeHtml(doc.title || '未命名文稿')}</h1>
      <div class="readerMeta">${escapeHtml(doc.folderId?folderLabel(doc.folderId):'未分类')} · ${formatDate(doc.updatedAt)}</div>
      ${paragraphs.map(p=>`<p>${escapeHtml(p).replace(/\n/g,'<br>')}</p>`).join('')}`;
    $('#editFromReader').textContent=doc.deletedAt?'恢复':'编辑';
    showOverlay('#reader');
  }
  function closeReader() { hideOverlay('#reader'); activeId=null; }
  function folderOptions(excludeId=null) {
    const excluded=excludeId?descendants(excludeId):new Set();
    const lines=[`<option value="">未分类 / 根目录</option>`];
    const walk=(parent,depth)=>{
      for(const item of folderChildren(parent)) {
        if(excluded.has(item.id))continue;
        lines.push(`<option value="${escapeHtml(item.id)}">${'　'.repeat(Math.min(depth,8))}${escapeHtml(item.name)}</option>`);
        walk(item.id,depth+1);
      }
    }; walk(null,0); return lines.join('');
  }
  function openEditor(id=null) {
    const doc=id?state.documents.find(item=>item.id===id):null;
    if(id&&!doc)return;
    editingId=doc?.id||null;
    draft=doc?{...doc,tags:[...doc.tags]}:{id:newId(),title:'',summary:'',body:'',tags:[],folderId:folderById(selected)?selected:null,createdAt:Date.now(),updatedAt:Date.now(),deletedAt:null};
    $('#editorTitle').textContent=doc?'编辑文稿':'新建文稿';
    $('#docTitle').value=draft.title;
    $('#docFolder').innerHTML=folderOptions();$('#docFolder').value=draft.folderId||'';
    $('#docSummary').value=draft.summary;$('#docTags').value=draft.tags.join(', ');$('#docBody').value=draft.body;
    $('#moveToTrash').hidden=!doc || !!doc.deletedAt;
    updateWordCount();showOverlay('#editor');
    if(!isMobile)$('#docTitle').focus();
  }
  function updateWordCount() { $('#wordCount').textContent=`${$('#docBody').value.replace(/\s/g,'').length.toLocaleString()} 字`; }
  function collectDraft() {
    if(!draft)return;
    draft.title=$('#docTitle').value;
    draft.folderId=$('#docFolder').value||null;
    draft.summary=$('#docSummary').value;
    draft.tags=$('#docTags').value.split(/[,，]/).map(tag=>tag.trim()).filter(Boolean).slice(0,30);
    draft.body=$('#docBody').value;
    updateWordCount();
  }
  function commitDraft() {
    if(!draft)return false;
    collectDraft();
    if(!editingId&&!draft.title.trim()&&!draft.body.trim()&&!draft.summary.trim())return false;
    draft.updatedAt=Date.now();
    if(!editingId){state.documents.push(draft);editingId=draft.id;$('#moveToTrash').hidden=false;$('#editorTitle').textContent='编辑文稿';}
    else {const index=state.documents.findIndex(doc=>doc.id===editingId); if(index>=0)state.documents[index]={...draft,tags:[...draft.tags]};}
    persistSoon();render();return true;
  }
  function closeEditor() { commitDraft(); hideOverlay('#editor'); editingId=null;draft=null; }
  function renderFolderManager() {
    const rows=[];
    const walk=(parent,depth)=>{
      for(const folder of folderChildren(parent)) {
        rows.push(`<div class="manageRow" style="--depth:${Math.min(depth,8)}"><div><strong>${escapeHtml(folder.name)}</strong>
          <small>${folderCount(folder.id)} 篇 · ${depth?'子目录':'根目录'}</small></div>
          <div class="manageActions"><button data-folder-act="child" data-id="${escapeHtml(folder.id)}" title="新建子目录">＋</button>
          <button data-folder-act="edit" data-id="${escapeHtml(folder.id)}" title="重命名或移动">编辑</button>
          <button data-folder-act="up" data-id="${escapeHtml(folder.id)}" title="上移">↑</button>
          <button data-folder-act="down" data-id="${escapeHtml(folder.id)}" title="下移">↓</button>
          <button data-folder-act="delete" data-id="${escapeHtml(folder.id)}" title="删除空目录">删除</button></div></div>`);
        walk(folder.id,depth+1);
      }
    };walk(null,0);
    $('#folderManageList').innerHTML=rows.join('')||'<div class="empty smallEmpty">还没有目录。点右上角创建第一个目录。</div>';
  }
  function openFolders() { closeSidebar(); renderFolderManager();$('#folderForm').hidden=true;showOverlay('#folderModal'); }
  function openFolderForm(id=null,parentId=null) {
    if(!$('#folderModal').classList.contains('open'))openFolders();
    folderEditingId=id;
    const folder=id?folderById(id):null;
    $('#folderFormTitle').textContent=folder?'编辑目录':'新建目录';
    $('#folderName').value=folder?.name||'';
    $('#folderParent').innerHTML=folderOptions(id);
    $('#folderParent').value=folder?.parentId||parentId||'';
    $('#folderForm').hidden=false;
    $('#folderName').focus();
  }
  function moveFolder(id,delta) {
    const folder=folderById(id);if(!folder)return;
    const siblings=folderChildren(folder.parentId),index=siblings.findIndex(f=>f.id===id),other=siblings[index+delta];
    if(!other)return;
    [siblings[index],siblings[index+delta]]=[siblings[index+delta],siblings[index]];
    siblings.forEach((item,i)=>item.order=i);
    persistSoon();renderFolderManager();render();
  }
  function deleteFolder(id) {
    const folder=folderById(id);if(!folder)return;
    if(state.folders.some(item=>item.parentId===id)||state.documents.some(doc=>doc.folderId===id)) {
      toast('请先移走子目录和文稿，再删除这个目录');return;
    }
    if(!confirm(`删除空目录「${folder.name}」？`))return;
    state.folders=state.folders.filter(item=>item.id!==id);
    if(selected===id)selected='all';
    persistSoon();renderFolderManager();render();
  }
  function moveToTrash() {
    if(!editingId)return;
    if(!confirm('将这篇文稿移入回收站？可以从回收站恢复。'))return;
    draft.deletedAt=Date.now();commitDraft();closeEditor();closeReader();toast('已移入回收站');
  }
  function restoreDoc(id) {
    const doc=state.documents.find(item=>item.id===id);if(!doc)return;
    doc.deletedAt=null;doc.updatedAt=Date.now();persistSoon();closeReader();render();toast('文稿已恢复');
  }
  function exportBackup() {
    if(draft)commitDraft();
    const payload={...state,exportedAt:new Date().toISOString()};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`文稿库备份-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    toast('备份已导出');
  }
  async function importBackup(file) {
    if(!file)return;
    let imported;
    try { imported=cleanImported(JSON.parse(await file.text())); }
    catch(error){toast(error.message);return;}
    if(!confirm(`导入 ${imported.documents.length} 篇文稿、${imported.folders.length} 个目录？当前浏览器的数据将被替换。建议先导出备份。`))return;
    state=imported;selected='all';activeId=null;editingId=null;draft=null;
    hideOverlay('#editor');hideOverlay('#reader');hideOverlay('#folderModal');
    $('#search').value='';flushSave();render();toast('导入完成');
  }
  function edgeGesture(element,direction,canStart,action) {
    let start=null;
    element.addEventListener('pointerdown',event=>{
      if(event.pointerType!=='touch'||!canStart())return;
      start={id:event.pointerId,x:event.clientX,y:event.clientY};
      try{element.setPointerCapture(event.pointerId);}catch(_){}
    });
    element.addEventListener('pointermove',event=>{
      if(!start||start.id!==event.pointerId)return;
      const dx=event.clientX-start.x,dy=event.clientY-start.y;
      if(Math.abs(dy)>Math.abs(dx)*1.2&&Math.abs(dy)>12){start=null;return;}
      if(dx*direction>55&&Math.abs(dx)>Math.abs(dy)*1.2){start=null;action();}
    });
    for(const type of ['pointerup','pointercancel'])element.addEventListener(type,()=>{start=null;});
  }

  $('#openMenu').onclick=openSidebar;$('#closeMenu').onclick=closeSidebar;$('#scrim').onclick=closeSidebar;
  $('#newDocTop').onclick=()=>openEditor();
  $('#search').oninput=renderList;$('#sort').onchange=renderList;
  $('#addRoot').onclick=()=>openFolderForm();$('#manageFolders').onclick=openFolders;
  $('#folderTree').onclick=event=>{
    const child=event.target.closest('[data-add-child]');
    if(child){openFolderForm(null,child.dataset.addChild);return;}
    const target=event.target.closest('[data-select]');if(target)selectFolder(target.dataset.select);
  };
  $('#docList').onclick=event=>{
    if(event.target.closest('[data-action="new"]')){openEditor();return;}
    const target=event.target.closest('[data-open]');if(target)openReader(target.dataset.open);
  };
  $('#closeReader').onclick=closeReader;
  $('#editFromReader').onclick=()=>{
    const doc=state.documents.find(item=>item.id===activeId);
    if(doc?.deletedAt){restoreDoc(activeId);return;}
    if(activeId){const id=activeId;closeReader();openEditor(id);}
  };
  $('#docForm').onsubmit=event=>{event.preventDefault();commitDraft();closeEditor();toast('文稿已保存');};
  $('#saveDoc').onclick=()=>{commitDraft();closeEditor();toast('文稿已保存');};
  $('#closeEditor').onclick=closeEditor;
  for(const id of ['docTitle','docFolder','docSummary','docTags','docBody'])
    $(`#${id}`).addEventListener('input',()=>{collectDraft();clearTimeout(persistTimer);persistTimer=setTimeout(commitDraft,500);});
  $('#moveToTrash').onclick=moveToTrash;
  $('#closeFolders').onclick=()=>hideOverlay('#folderModal');
  $('#newFolderInModal').onclick=()=>openFolderForm();
  $('#cancelFolder').onclick=()=>{$('#folderForm').hidden=true;folderEditingId=null;};
  $('#folderForm').onsubmit=event=>{
    event.preventDefault();const name=$('#folderName').value.trim(),parentId=$('#folderParent').value||null;
    if(!name){toast('请输入目录名称');return;}
    if(folderEditingId){const folder=folderById(folderEditingId);if(!folder)return;
      folder.name=name;folder.parentId=parentId;folder.order=folderChildren(parentId).length;}
    else state.folders.push({id:newId(),name,parentId,order:folderChildren(parentId).length});
    folderEditingId=null;$('#folderForm').hidden=true;persistSoon();renderFolderManager();render();toast('目录已保存');
  };
  $('#folderManageList').onclick=event=>{
    const target=event.target.closest('[data-folder-act]');if(!target)return;
    const id=target.dataset.id;
    switch(target.dataset.folderAct){
      case 'child':openFolderForm(null,id);break;
      case 'edit':openFolderForm(id);break;
      case 'up':moveFolder(id,-1);break;
      case 'down':moveFolder(id,1);break;
      case 'delete':deleteFolder(id);break;
    }
  };
  $('#exportData').onclick=exportBackup;
  $('#importData').onclick=()=>$('#importFile').click();
  $('#importFile').onchange=event=>{importBackup(event.target.files?.[0]);event.target.value='';};
  document.addEventListener('keydown',event=>{
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){
      event.preventDefault();if(draft){commitDraft();toast('文稿已保存');}else exportBackup();
    }
    if(event.key==='Escape'){
      if($('#editor').classList.contains('open'))closeEditor();
      else if($('#reader').classList.contains('open'))closeReader();
      else if($('#folderModal').classList.contains('open'))hideOverlay('#folderModal');
      else closeSidebar();
    }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&draft){commitDraft();flushSave();}});
  edgeGesture($('#openEdge'),1,()=>!document.body.classList.contains('drawerOpen')&&!document.querySelector('.overlay.open'),openSidebar);
  edgeGesture($('#closeEdge'),-1,()=>document.body.classList.contains('drawerOpen'),closeSidebar);
  edgeGesture($('#readerEdge'),1,()=>$('#reader').classList.contains('open'),closeReader);

  (async()=>{
    const stored=await readStored();
    if(stored){try{state=cleanImported(stored);}catch(error){toast(`保存的数据无法读取：${error.message}`);}}
    setSaveState(storageMode==='unavailable'?'请导出备份':'已保存至本设备');
    render();
  })();
})();

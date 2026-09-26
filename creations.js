(function(){
  "use strict";
  const DB_NAME="wengao-reader-creations";
  const STORE="articles";
  let opening;
  function db(){
    if(!opening) opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:"id"});
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    }).catch(error=>{opening=null;throw error;});
    return opening;
  }
  function run(mode,action){
    return db().then(database=>new Promise((resolve,reject)=>{
      const tx=database.transaction(STORE,mode);
      const request=action(tx.objectStore(STORE));
      tx.oncomplete=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
      tx.onabort=()=>reject(tx.error||new Error("保存失败"));
    }));
  }
  window.WG_CREATIONS={
    all:()=>run("readonly",store=>store.getAll()),
    save:article=>run("readwrite",store=>store.put(article))
  };
  window.WG_CREATIONS.mount=function(config){
    const {items,order,index,source,bodyOf,render,focusSaved,notice}=config;
    const $=selector=>document.querySelector(selector);
    const editor=$("#editor"), title=$("#editTitle"), body=$("#editBody");
    const saveButton=$("#editSave"), countLabel=$("#editCount");
    let current=-1, initialTitle="", initialBody="", opening=0;
    const charCount=text=>Array.from(text.replace(/\s/g,"")).length;
    const bucket=n=>n<=500?0:n<=900?1:n<=1500?2:n<=2500?3:n<=6000?4:5;
    const updateCount=()=>{countLabel.textContent=charCount(body.value).toLocaleString("zh-CN")+" 字";};
    function apply(record){
      const han=charCount(record.body);
      const item={t:record.title,body:record.body,own:true,id:record.id,src:source,
        bg:record.bg,big:record.big,tp:record.tp,se:record.se,tg:record.tg,
        han,bk:bucket(han),dup:0,s:record.body.slice(0,180),
        originSrc:record.originSrc,originTitle:record.originTitle};
      let i=index.get(record.id);
      if(i===undefined){i=items.length;items.push(item);index.set(record.id,i);order.unshift(i);}
      else {items[i]=item;order.splice(order.indexOf(i),1);order.unshift(i);}
      return i;
    }
    function cancel(){
      if((title.value!==initialTitle||body.value!==initialBody)&&
         !window.confirm("尚未保存修改，确定返回阅读页吗？")) return;
      opening++;
      editor.classList.remove("open");
    }
    async function open(i){
      const serial=++opening, item=items[i];
      current=i;
      title.value=item.t;
      body.value="";
      body.disabled=true;
      body.placeholder="正在读取正文…";
      saveButton.disabled=true;
      updateCount();
      editor.classList.add("open");
      try{
        const raw=await bodyOf(i);
        if(serial!==opening) return;
        body.value=raw.replace(/^\s*摘要[：:]\s*/,"");
        body.disabled=false;
        body.placeholder="在这里编辑正文";
        initialTitle=title.value;initialBody=body.value;
        updateCount();saveButton.disabled=false;
      }catch(error){
        if(serial!==opening) return;
        body.placeholder="正文读取失败，请返回后重试";
        notice("正文读取失败："+error.message);
      }
    }
    async function save(){
      const t=title.value.trim(), content=body.value.trim();
      if(!t){title.focus();notice("请填写标题");return;}
      if(!content){body.focus();notice("请填写正文");return;}
      saveButton.disabled=true;
      const item=items[current];
      const article={
        id:item.own?item.id:(crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random()),
        title:t,body:body.value,bg:item.bg,big:item.big,tp:item.tp,se:item.se,tg:item.tg,
        originSrc:item.own?item.originSrc:item.src,
        originTitle:item.own?item.originTitle:item.t,
        updated:Date.now()
      };
      try{
        await window.WG_CREATIONS.save(article);
        const i=apply(article);
        opening++;
        editor.classList.remove("open");
        focusSaved(i);
        notice("已保存到「我的创作」");
      }catch(error){
        notice("保存失败："+error.message);
        saveButton.disabled=false;
      }
    }
    $("#rCreate").onclick=()=>open(config.current());
    $("#editCancel").onclick=cancel;
    saveButton.onclick=save;
    body.addEventListener("input",updateCount);
    document.addEventListener("keydown",event=>{
      if(event.key==="Escape"&&editor.classList.contains("open")){
        event.preventDefault();event.stopImmediatePropagation();cancel();
      }
    },true);
    window.WG_CREATIONS.all().then(records=>{
      records.sort((a,b)=>a.updated-b.updated).forEach(apply);
      render();
    }).catch(error=>notice("读取「我的创作」失败："+error.message));
  };
})();

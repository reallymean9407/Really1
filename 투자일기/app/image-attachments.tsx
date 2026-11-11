'use client';

import {useEffect,useId,useRef,useState,type ChangeEvent} from 'react';
import {ArrowUpRight,Image as ImageIcon,ImagePlus,LoaderCircle,X} from 'lucide-react';
import type {DiaryImage} from './lib/model';
import './image-attachments.css';

const MAX_IMAGES=3;
const MAX_IMAGE_BYTES=5*1024*1024;
const IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif']);
const UPLOAD_TIMEOUT_MS=60_000;

function uploadContentType(file:File):string|null{
  const type=file.type.trim().toLowerCase();
  if(type==='image/jpg'||type==='image/pjpeg')return 'image/jpeg';
  if(IMAGE_TYPES.has(type))return type;
  if((!type||type==='application/octet-stream')&&/\.(jpe?g|png|webp|gif)$/i.test(file.name))return 'application/octet-stream';
  return null;
}

type ImageAttachmentsEditorProps={
  images:DiaryImage[];
  onAdd:(images:DiaryImage[])=>void;
  onRemove:(id:string)=>void;
  onBusyChange:(busy:boolean)=>void;
  disabled?:boolean;
};

function imagePath(id:string){return '/api/images/'+encodeURIComponent(id);}
function fileSize(bytes:number){return bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.ceil(bytes/1024))} KB`;}
function isDiaryImage(value:unknown):value is DiaryImage{
  if(!value||typeof value!=='object')return false;
  const item=value as Partial<DiaryImage>;
  return typeof item.id==='string'&&item.id.length>0&&typeof item.name==='string'&&typeof item.type==='string'&&IMAGE_TYPES.has(item.type)&&typeof item.size==='number'&&Number.isFinite(item.size)&&item.size>0&&item.size<=MAX_IMAGE_BYTES;
}

function ImagePreview({image}:{image:DiaryImage}){
  const [failed,setFailed]=useState(false);
  return <a className="attachment-preview" href={imagePath(image.id)} target="_blank" rel="noopener noreferrer" aria-label={image.name+' 크게 보기 (새 탭에서 열기)'}>
    {failed?<span className="attachment-preview-fallback"><ImageIcon size={23} strokeWidth={1.4}/><span>이미지 보기</span></span>:<img src={imagePath(image.id)} alt={image.name} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>}
    <span className="attachment-preview-open"><span>크게 보기</span><ArrowUpRight size={13}/></span>
  </a>;
}

export function ImageAttachmentsEditor({images,onAdd,onRemove,onBusyChange,disabled=false}:ImageAttachmentsEditorProps){
  const inputRef=useRef<HTMLInputElement>(null);
  const busyRef=useRef(false);
  const onBusyChangeRef=useRef(onBusyChange);
  onBusyChangeRef.current=onBusyChange;
  const mountedRef=useRef(true);
  const controllerRef=useRef<AbortController|null>(null);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState<{current:number;total:number}|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const helpId=useId();

  useEffect(()=>{mountedRef.current=true;return()=>{mountedRef.current=false;controllerRef.current?.abort();if(busyRef.current){busyRef.current=false;onBusyChangeRef.current(false);}};},[]);

  async function selectFiles(event:ChangeEvent<HTMLInputElement>){
    const files=Array.from(event.currentTarget.files||[]);
    event.currentTarget.value='';
    if(!files.length||disabled||busyRef.current)return;
    setError('');setNotice('');
    if(images.length+files.length>MAX_IMAGES){setError(`이미지는 일기마다 최대 3장까지 첨부할 수 있어요. 현재 ${images.length}장이 첨부되어 있으니 ${MAX_IMAGES-images.length}장 이하로 다시 선택해 주세요. 선택한 파일은 업로드하지 않았어요.`);return;}
    const unsupported=files.find(file=>!uploadContentType(file));
    if(unsupported){setError(`${unsupported.name}: JPEG, PNG, WebP, GIF 이미지만 첨부할 수 있어요. 선택한 파일은 업로드하지 않았어요.`);return;}
    const oversized=files.find(file=>file.size>MAX_IMAGE_BYTES);
    if(oversized){setError(`${oversized.name}: 이미지 한 장은 5 MB 이하여야 해요. 선택한 파일은 업로드하지 않았어요.`);return;}
    const empty=files.find(file=>file.size===0);
    if(empty){setError(`${empty.name}: 빈 파일은 첨부할 수 없어요. 선택한 파일은 업로드하지 않았어요.`);return;}

    busyRef.current=true;setBusy(true);onBusyChange(true);
    let completed=0;
    let failedFile=files[0].name;
    try{
      for(let index=0;index<files.length;index++){
        if(!mountedRef.current)break;
        const file=files[index];failedFile=file.name;
        setProgress({current:index+1,total:files.length});
        const controller=new AbortController();controllerRef.current=controller;
        let timedOut=false;
        const timeout=setTimeout(()=>{timedOut=true;controller.abort();},UPLOAD_TIMEOUT_MS);
        try{
          const response=await fetch('/api/images?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':uploadContentType(file)!},body:file,credentials:'same-origin',signal:controller.signal});
          const data=await response.json().catch(()=>null) as {image?:unknown;error?:string}|null;
          if(!response.ok)throw new Error(typeof data?.error==='string'?data.error:'이미지를 업로드하지 못했어요. 잠시 후 다시 시도해 주세요.');
          if(!isDiaryImage(data?.image))throw new Error('업로드 결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
          if(!mountedRef.current)break;
          onAdd([data.image]);completed++;
        }catch(reason){
          if(timedOut)throw new Error('업로드에 60초 이상 걸렸어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.');
          throw reason;
        }finally{clearTimeout(timeout);if(controllerRef.current===controller)controllerRef.current=null;}
      }
      if(mountedRef.current)setNotice(`이미지 ${completed}장을 첨부했어요.`);
    }catch(reason){
      if(mountedRef.current){
        const detail=reason instanceof Error&&reason.name!=='TypeError'?reason.message:'연결 상태를 확인한 뒤 다시 시도해 주세요.';
        const retained=completed?` 먼저 업로드한 ${completed}장은 그대로 첨부되어 있어요.`:'';
        const remaining=files.length-completed-1;
        setError(`${failedFile} 업로드에 실패했어요. ${detail}${retained}${remaining>0?` 나머지 ${remaining}장은 업로드하지 않았어요.`:''}`);
      }
    }finally{
      busyRef.current=false;
      if(mountedRef.current){setBusy(false);setProgress(null);onBusyChange(false);}
    }
  }

  return <section className="image-attachments-editor field" aria-label="일기 이미지 첨부" aria-busy={busy}>
    <div className="attachment-heading"><div><ImageIcon size={14}/><span>이미지 첨부</span><small>선택</small></div><span className="attachment-count" aria-label={`첨부 이미지 ${images.length}장, 최대 3장`}>{images.length}<span>/ 3</span></span></div>
    {images.length>0&&<div className="image-attachments-grid editor-attachments-grid">{images.map(image=><div className="attachment-item" key={image.id}>
      <ImagePreview image={image}/>
      <button type="button" className="attachment-remove" disabled={disabled||busy} aria-label={image.name+' 첨부 해제'} title="첨부 해제" onClick={()=>onRemove(image.id)}><X size={13}/></button>
      <div className="attachment-caption"><span title={image.name}>{image.name}</span><small>{fileSize(image.size)}</small></div>
    </div>)}</div>}
    <input ref={inputRef} className="attachment-file-input" type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif" disabled={disabled||busy||images.length>=MAX_IMAGES} onChange={selectFiles} aria-label="첨부할 이미지 선택" tabIndex={-1}/>
    <button type="button" className="attachment-picker" aria-describedby={helpId} disabled={disabled||busy||images.length>=MAX_IMAGES} onClick={()=>inputRef.current?.click()}>{busy?<LoaderCircle className="spin" size={17}/>:<ImagePlus size={18} strokeWidth={1.5}/>}<span>{busy?`이미지 업로드 중 · ${progress?.current||1}/${progress?.total||1}`:images.length>=MAX_IMAGES?'이미지 3장이 첨부되어 있어요':'이미지 추가하기'}</span>{!busy&&images.length<MAX_IMAGES&&<small>최대 3장</small>}</button>
    <p className="attachment-help" id={helpId}>JPEG · PNG · WebP · GIF, 한 장당 최대 5 MB<br/>일기 저장을 누르면 첨부 내용이 반영됩니다.</p>
    {busy&&<p className="attachment-status" role="status" aria-live="polite">{progress?.current||1}/{progress?.total||1} 업로드 중이에요. 완료되면 일기를 저장할 수 있어요.</p>}
    {!busy&&notice&&<p className="attachment-status" role="status">{notice}</p>}
    {error&&<div className="attachment-error" role="alert">{error}</div>}
  </section>;
}

export function DiaryImages({images}:{images?:DiaryImage[]}){
  if(!images?.length)return null;
  return <section className="diary-images" aria-label={`첨부 이미지 ${images.length}장`}>
    <div className="diary-images-heading"><ImageIcon size={12}/><span>함께 남긴 이미지</span><small>{images.length}장</small></div>
    <div className="image-attachments-grid">{images.map(image=><div className="attachment-item" key={image.id}><ImagePreview image={image}/><div className="attachment-caption"><span title={image.name}>{image.name}</span><small>{fileSize(image.size)}</small></div></div>)}</div>
  </section>;
}

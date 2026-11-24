import React,{useState} from 'react';
import Adaptive from './Adaptive.jsx';
import Assistance from './Assistance.jsx';
import Goals from './Goals.jsx';
import ContextBudget from './ContextBudget.jsx';
export default function Strategies(props){
  const [tab,setTab]=useState('assistance'),{t}=props;
  return <><div className="tabs section-tabs" aria-label={t('กลยุทธ์การทำงาน','Task strategy')}>
    <button className={tab==='assistance'?'selected':''} onClick={()=>setTab('assistance')}>{t('Executor และ Asst.','Executor & Asst.')}</button>
    <button className={tab==='adaptive'?'selected':''} onClick={()=>setTab('adaptive')}>{t('ทักษะและวงจรตรวจสอบ','Skills & verification loop')}</button>
    <button className={tab==='goals'?'selected':''} onClick={()=>setTab('goals')}>{t('เป้าหมายและหลักฐาน','Goals & evidence')}</button>
    <button className={tab==='context'?'selected':''} onClick={()=>setTab('context')}>{t('งบประมาณ Context','Context budget')}</button>
  </div>{tab==='assistance'?<Assistance {...props}/>:tab==='adaptive'?<Adaptive {...props}/>:tab==='goals'?<Goals {...props}/>:<ContextBudget {...props}/>}</>;
}

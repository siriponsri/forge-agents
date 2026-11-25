import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Bot, MessagesSquare, Play, Wrench, FileCheck2, Maximize2, Minus, Plus, List, Network, X} from 'lucide-react';
import {createConversationGraph, graphTone} from './agent-graph.mjs';
import {safeLocalUrl} from './api.mjs';
import './agent-workspace.css';

const icons = {room: MessagesSquare, bot: Bot, run: Play, tool: Wrench, artifact: FileCheck2};
export default function AgentWorkspace({state, projectId, room, t, connected, renderRun}) {
  const graph = useMemo(() => createConversationGraph(state, projectId, room.id), [state, projectId, room.id]);
  const [selected, setSelected] = useState(null), [zoom, setZoom] = useState(1), [list, setList] = useState(false);
  const viewport = useRef(null), marker = `graph-arrow-${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const node = graph.nodes.find(item => item.id === selected);
  const selectedRun = node?.runId ? graph.runs.find(item => item.id === node.runId) : node?.kind === 'bot' && node.sourceId ? graph.runs.find(item => item.botId === node.sourceId) : null;
  const fit = () => {setZoom(Math.min(1, Math.max(0.85, (viewport.current?.clientWidth ?? graph.width) / (graph.width + 48)))); viewport.current?.scrollTo({left: 0, top: 0});};
  useEffect(() => {setSelected(null); setZoom(1);}, [room.id, projectId]);
  const labels = {room: t('ห้องสนทนา', 'Conversation'), bot: t('สมาชิกที่ถูกเรียก', 'Called agent'), run: t('การรัน', 'Run'), tool: t('เครื่องมือ', 'Tool'), artifact: t('ผลงาน', 'Artifact')};
  const statusLabel = status => ({running: t('กำลังทำงาน', 'Running'), submitting: t('กำลังส่งงาน', 'Submitting'), queued: t('อยู่ในคิว', 'Queued'), starting: t('กำลังเริ่ม', 'Starting'), submitted: t('ส่งงานแล้ว', 'Submitted'), stopping: t('กำลังขอหยุด', 'Stopping'), waiting: t('รอคำตอบ / อนุมัติ', 'Needs your input'), unknown: t('ยังยืนยันผลไม่ได้', 'Outcome unconfirmed'), interrupted: t('ถูกขัดจังหวะ', 'Interrupted'), completed: t('รันสิ้นสุดแล้ว', 'Run completed'), verified: t('ตรวจไฟล์แล้ว', 'Verified'), failed: t('ล้มเหลว', 'Failed'), cancelled: t('ยกเลิกแล้ว', 'Cancelled'), 'not-executed': t('ไม่ได้เรียกทำงาน', 'Not executed'), context: t('บริบทห้อง', 'Room context')})[status] ?? status;
  const title = item => item.title || (item.kind === 'bot' ? t('ยังระบุ agent ไม่ได้', 'Unattributed agent') : t('ห้องสนทนา', 'Conversation'));
  const NodeIcon = node ? icons[node.kind] : Network;
  const describe = item => `${labels[item.kind]} · ${title(item)} · ${statusLabel(item.status)}`;
  const relationship = kind => ({'room-binding': t('บริบทห้อง ไม่ใช่คำสั่งเรียก', 'Room context, not a dispatch'), execution: t('การรันที่ผูกกับ agent', 'Agent execution record'), tool: t('การเรียกเครื่องมือที่สังเกตได้', 'Observed tool call'), artifact: t('ผลงานที่ run อ้างถึง', 'Artifact referenced by run'), delegation: t('Parent run ที่บันทึกไว้', 'Recorded parent run')})[kind];
  return <section className="agent-workspace" aria-label="Visualization Workspace">
    <div className="agent-graph-toolbar">
      <div className="agent-observation"><span className={connected ? 'is-observing' : ''} aria-hidden="true"/><strong>{connected ? t('กำลังรับสถานะ', 'Observing updates') : t('สถานะที่บันทึกไว้', 'Recorded state')}</strong><span>{t('ห้อง → Agent → Run → เครื่องมือ / ผลงาน', 'Room → Agent → Run → tools / outputs')}</span></div>
      <div className="agent-graph-controls">
        <button type="button" aria-pressed={list} onClick={() => setList(value => !value)}><List size={15}/>{list ? t('ดู graph', 'Show graph') : t('ดูรายการ', 'Show list')}</button>
        <button type="button" onClick={fit}><Maximize2 size={15}/>{t('จัดมุมมอง', 'Fit readable')}</button>
        <button type="button" aria-label={t('ย่อ graph', 'Zoom out')} disabled={zoom <= 0.85} onClick={() => setZoom(value => Math.max(0.85, value - 0.15))}><Minus size={15}/></button>
        <output aria-label={t('ขนาด graph', 'Graph zoom')}>{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label={t('ขยาย graph', 'Zoom in')} disabled={zoom >= 1.45} onClick={() => setZoom(value => Math.min(1.45, value + 0.15))}><Plus size={15}/></button>
      </div>
    </div>
    {!graph.runs.length ? <div className="agent-graph-empty"><Network size={38}/><h3>{t('บทสนทนาจะกลายเป็นภาพการทำงานที่นี่', 'Your conversation becomes a working graph here')}</h3><p>{t('ยังไม่มี run ที่ผูกกับห้องนี้ ส่งคำขอให้ provider จาก Chat แล้วกลับมาดู agent เครื่องมือ และผลงานที่เกิดขึ้นจริง', 'No run is linked to this room yet. Request a provider reply from Chat to inspect actual agents, tools and outputs here.')}</p></div> : list ? <ul className="agent-node-list">{graph.nodes.map(item => <li key={item.id}><button type="button" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{describe(item)}</button></li>)}</ul> : <div className="agent-graph-viewport" ref={viewport} tabIndex={0} role="region" aria-label={t('พื้นที่ graph เลื่อนเพื่อสำรวจ หรือใช้ดูรายการ', 'Scrollable graph. Use Show list for a linear view')}>
      <div style={{width: graph.width * zoom, height: graph.height * zoom}}><div className="agent-graph-stage" style={{width: graph.width, height: graph.height, transform: `scale(${zoom})`}}>
        <svg className="agent-connectors" width={graph.width} height={graph.height} aria-hidden="true"><defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M 0 0 L 7 3.5 L 0 7 Z" fill="var(--line-strong)"/></marker></defs>{graph.edges.map(edge => {const source = graph.nodes.find(item => item.id === edge.source), target = graph.nodes.find(item => item.id === edge.target); const startX = source.x + 220, startY = source.y + 46, endX = target.x - 8, endY = target.y + 46; return <path key={edge.id} className={`agent-edge edge-${edge.kind} ${graphTone(target.status) === 'active' && connected && target.observing ? 'edge-active' : ''}`} d={`M ${startX} ${startY} C ${startX + 40} ${startY}, ${endX - 40} ${endY}, ${endX} ${endY}`} markerEnd={`url(#${marker})`}/>;})}</svg>
        {graph.nodes.map(item => {const Icon = icons[item.kind];return <button type="button" key={item.id} className={`agent-node tone-${graphTone(item.status)} ${selected === item.id ? 'node-selected' : ''}`} style={{left: item.x, top: item.y}} aria-label={describe(item)} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><span className="agent-node-kind"><Icon size={15}/>{labels[item.kind]}</span><strong>{title(item)}</strong><span className="agent-node-status"><span aria-hidden="true"/>{statusLabel(item.status)}</span></button>;})}
      </div></div>
    </div>}
    <div className="agent-graph-legend"><span>{t('เส้นทึบ: run / เครื่องมือ', 'Solid: run / tool')}</span><span>{t('ประสั้น: บริบทห้อง', 'Short dash: room context')}</span><span>{t('จุด: ผูกผลงาน', 'Dotted: artifact reference')}</span>{graph.edges.some(edge=>edge.kind==='delegation')&&<span>{t('ประยาว: delegation ที่บันทึก', 'Long dash: recorded delegation')}</span>}{graph.omittedRuns > 0 && <span>{t(`แสดง 8 runs · อีก ${graph.omittedRuns} ในประวัติห้อง`, `Showing 8 runs · ${graph.omittedRuns} more in room history`)}</span>}</div>
    <div className="agent-inspector" aria-live="polite">
      {node&&<ul className="agent-relationship-list" aria-label={t('ความสัมพันธ์ของ node','Node relationships')}>{graph.edges.filter(edge=>edge.target===node.id).map(edge=><li key={edge.id}>{relationship(edge.kind)} · {title(graph.nodes.find(item=>item.id===edge.source))}</li>)}</ul>}
      {node ? <><div className="agent-inspector-heading"><h3><NodeIcon size={18}/>{title(node)}</h3><button type="button" onClick={() => setSelected(null)} aria-label={t('ปิดรายละเอียด graph', 'Close graph details')}><X size={15}/></button></div><p>{labels[node.kind]} · {statusLabel(node.status)}</p>{node.detail && <p>{node.detail === 'result-unconfirmed' ? t('เห็นการเรียกเครื่องมือ แต่ยังไม่มีผลลัพธ์ที่ยืนยัน', 'Tool call observed; its result has not been confirmed.') : node.detail}</p>}{node.kind === 'run' && (node.hiddenTools > 0 || node.hiddenArtifacts > 0) && <p>{t('ยังมีรายการเพิ่มเติมในรายละเอียดการรัน', 'More tools or outputs are available in run details.')}</p>}{node.kind === 'artifact' && <a href={safeLocalUrl(`/api/artifacts/${encodeURIComponent(node.sourceId)}/download`)}>{t('เปิด / ดาวน์โหลดผลงาน', 'Open / download artifact')}</a>}{selectedRun && renderRun(selectedRun)}</> : <p><Network size={17}/>{t('เลือก node เพื่อดูสถานะ หลักฐาน และปุ่มควบคุมของ run เดิม', 'Select a node for its state, evidence and existing run controls.')}</p>}
    </div>
  </section>;
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Archive, ArrowLeft, ArrowRight, ChevronDown, CirclePlus, Download, FileUp, MoonStar, Plus, Save, Sun, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";

type DayRecord = { id: string; startAt: string; endAt: string | null; createdAt: string; updatedAt: string };
type TimeEvent = { id: string; dayId: string; title: string; content: string; startAt: string; endAt: string | null; color: string; createdAt: string; updatedAt: string; deletedAt?: string | null };
type Review = { id: string; dayId: string; content: string; createdAt: string; updatedAt: string; deletedAt?: string | null };
type StandardItem = { id: string; title: string; durationMinutes: number; color: string };
type VisualTheme = "original" | "soft";
type AppData = {
  schemaVersion: 1;
  deviceId: string;
  days: DayRecord[];
  events: TimeEvent[];
  reviews: Review[];
  standard: { enabled: boolean; items: StandardItem[]; updatedAt: string };
};

type WebMcpContext = {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: unknown) => unknown;
  }, options?: { signal?: AbortSignal }) => void | Promise<void>;
};

const STORAGE_KEY = "time-ring-journal-v1";
const THEME_STORAGE_KEY = "time-ring-visual-theme";
const COLORS = ["#013E75", "#A42423", "#A66F08", "#315762", "#4E6754", "#C05A28", "#211E1A"];
const SOFT_COLORS: Record<string, string> = {
  "#013E75": "#6B7BB4",
  "#A42423": "#FFA62B",
  "#A66F08": "#86C5FF",
  "#315762": "#7FA921",
  "#4E6754": "#4B5CC4",
  "#C05A28": "#F8E6A0",
  "#211E1A": "#A77BA8",
};
const COLOR_UPGRADES: Record<string, string> = {
  "#73A9D8": COLORS[0], "#F0A88C": COLORS[1], "#8CBFA5": COLORS[2], "#B9A1DC": COLORS[3],
  "#E5C16E": COLORS[4], "#77BFC5": COLORS[5], "#D98BA6": COLORS[6],
  "#4361EE": COLORS[0], "#FF4D8D": COLORS[1], "#00A896": COLORS[2], "#9B5DE5": COLORS[3],
  "#F59E0B": COLORS[4], "#00A9CE": COLORS[5], "#E8366F": COLORS[6],
};
const vividColor = (color: string) => COLOR_UPGRADES[color.toUpperCase()] ?? color;
const displayColor = (color: string, theme: VisualTheme) => {
  const original = vividColor(color);
  return theme === "soft" ? (SOFT_COLORS[original.toUpperCase()] ?? original) : original;
};
const readableTextColor = (background: string) => {
  const value = background.replace("#", "");
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return luminance > .34 ? "#33415D" : "#FFFAF3";
};
const id = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const nowIso = () => new Date().toISOString();
const pad = (value: number) => `${value}`.padStart(2, "0");
const toDateTimeLocal = (iso?: string | null) => {
  const date = iso ? new Date(iso) : new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const fromDateTimeLocal = (value: string) => new Date(value).toISOString();
const fmtTime = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` };
const fmtDate = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日` };
const fmtWeekday = (iso: string) => "日一二三四五六"[new Date(iso).getDay()];
const minutesBetween = (a: string | Date, b: string | Date) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;
const addMinutes = (iso: string | Date, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60000);

function emptyData(): AppData {
  return { schemaVersion: 1, deviceId: id(), days: [], events: [], reviews: [], standard: { enabled: false, items: [], updatedAt: nowIso() } };
}

function roundToHalfHour(iso: string) {
  const date = new Date(iso);
  date.setSeconds(0, 0);
  date.setMinutes(Math.round(date.getMinutes() / 30) * 30);
  return date;
}

function polar(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function arcPath(cx: number, cy: number, radius: number, start: number, end: number) {
  const span = Math.max(0.05, end - start);
  const p1 = polar(cx, cy, radius, start);
  const p2 = polar(cx, cy, radius, end);
  return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${span > 180 ? 1 : 0} 1 ${p2.x} ${p2.y}`;
}

function splitEvent(event: TimeEvent, day: DayRecord, anchor: Date) {
  if (!event.endAt) return [];
  const start = new Date(event.startAt).getTime();
  const end = new Date(event.endAt).getTime();
  if (end <= start) return [];
  const dayStart = new Date(day.startAt).getTime();
  const anchorMs = anchor.getTime();
  const cuts = new Set<number>([start, end]);
  for (let n = Math.floor((start - dayStart) / 86400000) - 1; n <= Math.ceil((end - dayStart) / 86400000) + 1; n++) {
    const t = dayStart + n * 86400000;
    if (t > start && t < end) cuts.add(t);
  }
  for (let n = Math.floor((start - anchorMs) / 86400000) - 1; n <= Math.ceil((end - anchorMs) / 86400000) + 1; n++) {
    const t = anchorMs + n * 86400000;
    if (t > start && t < end) cuts.add(t);
  }
  const points = [...cuts].sort((a, b) => a - b);
  return points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    const lap = Math.max(0, Math.floor(((point + next) / 2 - dayStart) / 86400000));
    const startAngle = ((point - anchorMs) / 240000) % 360;
    return { startAngle: (startAngle + 360) % 360, endAngle: (startAngle + 360) % 360 + (next - point) / 240000, lap };
  });
}

function DayRing({ day, events, onSelect, theme }: { day: DayRecord; events: TimeEvent[]; onSelect: (event: TimeEvent) => void; theme: VisualTheme }) {
  const anchor = roundToHalfHour(day.startAt);
  const cx = 190, cy = 190, outerRadius = 128, ringWidth = 44, overflowRadius = 92, overflowWidth = 18, tickRadius = 165;
  const dayStartMs = new Date(day.startAt).getTime();
  return (
    <svg viewBox="0 0 380 380" className="time-ring" role="img" aria-label="当日时间圆环">
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = i * 45;
        const labelPos = polar(cx, cy, tickRadius, angle);
        return <g key={i}>
          <path d={arcPath(cx, cy, outerRadius, i * 45 + 2.2, (i + 1) * 45 - 2.2)} fill="none" stroke="var(--ring-base)" strokeWidth={ringWidth} strokeLinecap="butt" />
          <text x={labelPos.x} y={labelPos.y + 4} textAnchor="middle" className="ring-time-label">{fmtTime(addMinutes(anchor, i * 180).toISOString())}</text>
        </g>;
      })}
      {events.map((event) => {
        const markerAngle = ((minutesBetween(anchor, event.startAt) / 4 + 360) % 360);
        const eventStartMs = new Date(event.startAt).getTime();
        const isOverflow = eventStartMs >= dayStartMs + 86400000;
        const markerRadius = isOverflow ? overflowRadius : outerRadius;
        const markerWidth = isOverflow ? overflowWidth - 4 : ringWidth - 6;
        const markerInner = polar(cx, cy, markerRadius - markerWidth / 2, markerAngle);
        const markerOuter = polar(cx, cy, markerRadius + markerWidth / 2, markerAngle);
        const segments = splitEvent(event, day, anchor);
        const color = displayColor(event.color, theme);
        return <g key={event.id} className="cursor-pointer" onClick={() => onSelect(event)} role="button" tabIndex={0}>
          <title>{`${event.title} · ${fmtTime(event.startAt)}${event.endAt ? `—${fmtTime(event.endAt)}` : ""}`}</title>
          {segments.map((segment, index) => {
            if (segment.lap === 0) return <path key={index} d={arcPath(cx, cy, outerRadius, segment.startAngle, segment.endAngle)} fill="none" stroke={color} strokeWidth={ringWidth} strokeLinecap="butt" opacity=".94" />;
            return <path key={index} d={arcPath(cx, cy, overflowRadius, segment.startAngle, segment.endAngle)} fill="none" stroke={color} strokeWidth={overflowWidth} strokeLinecap="butt" opacity=".94" />;
          })}
          {!event.endAt && <line x1={markerInner.x} y1={markerInner.y} x2={markerOuter.x} y2={markerOuter.y} stroke={color} strokeWidth="1.5" opacity=".72" />}
        </g>;
      })}
      <circle cx={cx} cy={cy} r="78" fill="var(--ring-center-bg)" stroke="var(--ring-center-border)" />
      <text x={cx} y={cy - 22} textAnchor="middle" className="ring-center-kicker">从入睡开始</text>
      <text x={cx} y={cy + 12} textAnchor="middle" className="ring-center-time">{fmtTime(day.startAt)}</text>
      <text x={cx} y={cy + 38} textAnchor="middle" className="ring-center-date">{fmtDate(day.startAt)} · 周{fmtWeekday(day.startAt)}</text>
    </svg>
  );
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return remainder ? `${hours}小时${remainder}分` : `${hours}小时`;
}

function formatHalfHourDuration(minutes: number) {
  const rounded = Math.max(30, Math.round(minutes / 30) * 30);
  const hours = rounded / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}小时`;
}

function formatCompactHalfHourDuration(minutes: number) {
  const rounded = Math.max(30, Math.round(minutes / 30) * 30);
  if (rounded === 30) return "30m";
  const hours = rounded / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function compactStripTitle(title: string, width: number) {
  if (width >= 18) return title;
  const limit = width >= 11 ? 4 : width >= 6 ? 2 : 1;
  return title.length > limit ? `${title.slice(0, limit)}…` : title;
}

function StandardRing({ items, theme }: { items: StandardItem[]; theme: VisualTheme }) {
  let cursor = 0;
  return <svg viewBox="0 0 160 160" className="standard-ring" aria-label="标准日程">
    <circle cx="80" cy="80" r="53" fill="none" stroke="var(--standard-ring-base)" strokeWidth="30" />
    {items.map((item) => {
      const start = cursor / 4, end = start + item.durationMinutes / 4;
      const label = polar(80, 80, 53, start + (end - start) / 2);
      cursor += item.durationMinutes;
      return <g key={item.id}>
        <path d={arcPath(80, 80, 53, start, end)} fill="none" stroke={displayColor(item.color, theme)} strokeWidth="30" opacity=".9"><title>{`${item.title} · ${formatDuration(item.durationMinutes)}`}</title></path>
        <text x={label.x} y={label.y + 2.5} textAnchor="middle" className="standard-item-label">{item.title.length > 5 ? `${item.title.slice(0, 5)}…` : item.title}</text>
      </g>;
    })}
    <text x="80" y="76" textAnchor="middle" className="standard-title">标准日</text>
    <text x="80" y="95" textAnchor="middle" className="standard-total">{formatDuration(items.reduce((sum, item) => sum + item.durationMinutes, 0))}</text>
  </svg>;
}

function DayStrip({ day, events, reviews, theme }: { day: DayRecord; events: TimeEvent[]; reviews: Review[]; theme: VisualTheme }) {
  const endAt = day.endAt ?? nowIso();
  const total = Math.max(1, minutesBetween(day.startAt, endAt));
  return <section className="review-row">
    <div className="review-row-head"><div><strong>{fmtDate(day.startAt)}</strong><span>周{fmtWeekday(day.startAt)}</span></div><span>{fmtTime(day.startAt)}—{day.endAt ? fmtTime(day.endAt) : "现在"}</span></div>
    <div className="day-strip" aria-label={`${fmtDate(day.startAt)}时间条`}>
      {events.map((event) => {
        const left = Math.max(0, Math.min(100, (minutesBetween(day.startAt, event.startAt) / total) * 100));
        const color = displayColor(event.color, theme);
        if (!event.endAt) return <span key={event.id} className="strip-marker" style={{ left: `${left}%`, borderColor: color }} title={`${event.title} ${fmtTime(event.startAt)}`}><i>{fmtTime(event.startAt)}</i></span>;
        const width = Math.max(.7, (minutesBetween(event.startAt, event.endAt) / total) * 100);
        const visibleWidth = Math.min(width, 100 - left);
        const duration = formatHalfHourDuration(minutesBetween(event.startAt, event.endAt));
        const compactDuration = formatCompactHalfHourDuration(minutesBetween(event.startAt, event.endAt));
        const compact = visibleWidth < 18;
        const foreground = theme === "soft" ? readableTextColor(color) : "#FFFFFF";
        const darkText = foreground === "#33415D";
        return <span key={event.id} className={`strip-segment${compact ? " strip-segment-compact" : ""}${darkText ? " strip-segment-dark-text" : ""}`} style={{ left: `${left}%`, width: `${visibleWidth}%`, background: color, color: foreground }} title={`${event.title} · ${duration} · ${fmtTime(event.startAt)}—${fmtTime(event.endAt)}`}><span><b>{compactStripTitle(event.title, visibleWidth)}</b><em>{compact ? compactDuration : ` · ${duration}`}</em></span></span>;
      })}
    </div>
    {reviews.map((review) => <div key={review.id} className="saved-review"><span>{new Date(review.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><p>{review.content}</p></div>)}
  </section>;
}

function mergeById<T extends { id: string; updatedAt: string }>(local: T[], incoming: T[]) {
  const map = new Map(local.map((item) => [item.id, item]));
  for (const item of incoming) {
    const current = map.get(item.id);
    if (!current || new Date(item.updatedAt).getTime() > new Date(current.updatedAt).getTime()) map.set(item.id, item);
  }
  return [...map.values()];
}

export default function Home() {
  const [data, setData] = useState<AppData | null>(null);
  const [theme, setTheme] = useState<VisualTheme | null>(null);
  const [tab, setTab] = useState("today");
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [eventDialog, setEventDialog] = useState(false);
  const [newDayDialog, setNewDayDialog] = useState(false);
  const [standardDialog, setStandardDialog] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimeEvent | null>(null);
  const [eventStart, setEventStart] = useState(toDateTimeLocal());
  const [eventEnd, setEventEnd] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [eventContent, setEventContent] = useState("");
  const [eventColor, setEventColor] = useState(COLORS[0]);
  const [sleepStart, setSleepStart] = useState(toDateTimeLocal());
  const [reviewText, setReviewText] = useState("");
  const [reviewTargetDayId, setReviewTargetDayId] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const initialTheme: VisualTheme = savedTheme === "soft" ? "soft" : "original";
    document.documentElement.dataset.theme = initialTheme;
    const frame = requestAnimationFrame(() => setTheme(initialTheme));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const loaded = raw ? (JSON.parse(raw) as AppData) : emptyData();
    setData(loaded);
    const latest = [...loaded.days].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)).at(-1);
    setSelectedDayId(latest?.id ?? null);
    setReviewTargetDayId(latest?.id ?? null);
    if (!latest) setNewDayDialog(true);
  }, []);
  useEffect(() => { if (data) localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) }, [data]);

  useEffect(() => {
    if (!data) return;
    const context = (document as Document & { modelContext?: WebMcpContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: "create_time_record",
        title: "添加时间记录",
        description: "在当前记录日中添加一个带时间、题目和正文的刻度。结束时间可以省略。",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" }, content: { type: "string" },
            startAt: { type: "string", description: "ISO 8601时间" },
            endAt: { type: ["string", "null"], description: "可选的ISO 8601结束时间" },
          },
          required: ["title", "startAt"], additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const value = input as { title?: string; content?: string; startAt?: string; endAt?: string | null };
          const day = [...data.days].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)).at(-1);
          if (!day || !value.title?.trim() || !value.startAt || Number.isNaN(+new Date(value.startAt))) throw new Error("需要有效的题目、时间和记录日");
          const timestamp = nowIso();
          const record: TimeEvent = { id: id(), dayId: day.id, title: value.title.trim(), content: value.content?.trim() ?? "", startAt: new Date(value.startAt).toISOString(), endAt: value.endAt ? new Date(value.endAt).toISOString() : null, color: COLORS[data.events.filter((item) => item.dayId === day.id && !item.deletedAt).length % COLORS.length], createdAt: timestamp, updatedAt: timestamp };
          setData((current) => current ? { ...current, events: [...current.events, record] } : current);
          return { id: record.id, dayId: day.id, status: "saved" };
        },
      }, { signal: lifecycle.signal });
      await context.registerTool({
        name: "add_review_note",
        title: "保存复盘文字",
        description: "把一段自由文本保存到当前记录日的复盘下方。",
        inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const value = input as { content?: string };
          const day = [...data.days].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)).at(-1);
          if (!day || !value.content?.trim()) throw new Error("需要复盘文字和记录日");
          const timestamp = nowIso();
          const review: Review = { id: id(), dayId: day.id, content: value.content.trim(), createdAt: timestamp, updatedAt: timestamp };
          setData((current) => current ? { ...current, reviews: [...current.reviews, review] } : current);
          return { id: review.id, dayId: day.id, status: "saved" };
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [data]);

  const activeEvents = useMemo(() => data?.events.filter((event) => !event.deletedAt) ?? [], [data]);
  const activeReviews = useMemo(() => data?.reviews.filter((review) => !review.deletedAt) ?? [], [data]);
  const sortedDays = useMemo(() => [...(data?.days ?? [])].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)), [data]);
  const selectedIndex = Math.max(0, sortedDays.findIndex((day) => day.id === selectedDayId));
  const selectedDay = sortedDays[selectedIndex] ?? null;
  const reviewEndIndex = Math.max(0, sortedDays.findIndex((day) => day.id === reviewTargetDayId));
  const reviewDays = sortedDays.slice(Math.max(0, reviewEndIndex - 13), reviewEndIndex + 1);

  function createDay() {
    if (!data || !sleepStart) return;
    const startAt = fromDateTimeLocal(sleepStart), timestamp = nowIso(), previous = sortedDays.at(-1);
    const nextDays = data.days.map((day) => day.id === previous?.id ? { ...day, endAt: startAt, updatedAt: timestamp } : day);
    const day: DayRecord = { id: id(), startAt, endAt: null, createdAt: timestamp, updatedAt: timestamp };
    const sleep: TimeEvent = { id: id(), dayId: day.id, title: "睡觉", content: "", startAt, endAt: null, color: COLORS[0], createdAt: timestamp, updatedAt: timestamp };
    setData({ ...data, days: [...nextDays, day], events: [...data.events, sleep] });
    setSelectedDayId(day.id); setReviewTargetDayId(day.id); setNewDayDialog(false); toast.success("新的记录日已开始");
  }
  function openNewEvent() {
    if (!selectedDay) return;
    const nextColor = COLORS[activeEvents.filter((item) => item.dayId === selectedDay.id).length % COLORS.length];
    setEditingEvent(null); setEventStart(toDateTimeLocal()); setEventEnd(""); setEventTitle(""); setEventContent(""); setEventColor(nextColor); setEventDialog(true);
  }
  function openEvent(event: TimeEvent) {
    setEditingEvent(event); setEventStart(toDateTimeLocal(event.startAt)); setEventEnd(event.endAt ? toDateTimeLocal(event.endAt) : ""); setEventTitle(event.title); setEventContent(event.content); setEventColor(vividColor(event.color)); setEventDialog(true);
  }
  function saveEvent() {
    if (!data || !selectedDay || !eventTitle.trim() || !eventStart) return;
    const timestamp = nowIso();
    if (editingEvent) {
      setData({ ...data, events: data.events.map((event) => event.id === editingEvent.id ? { ...event, title: eventTitle.trim(), content: eventContent.trim(), startAt: fromDateTimeLocal(eventStart), endAt: eventEnd ? fromDateTimeLocal(eventEnd) : null, color: eventColor, updatedAt: timestamp } : event) });
    } else {
      const event: TimeEvent = { id: id(), dayId: selectedDay.id, title: eventTitle.trim(), content: eventContent.trim(), startAt: fromDateTimeLocal(eventStart), endAt: null, color: eventColor, createdAt: timestamp, updatedAt: timestamp };
      setData({ ...data, events: [...data.events, event] });
    }
    setEventDialog(false); toast.success(editingEvent ? "记录已更新" : "刻度已记录");
  }
  function deleteEvent() {
    if (!data || !editingEvent) return;
    const timestamp = nowIso();
    setData({ ...data, events: data.events.map((event) => event.id === editingEvent.id ? { ...event, deletedAt: timestamp, updatedAt: timestamp } : event) });
    setEventDialog(false); toast.success("记录已删除");
  }
  function saveReview() {
    if (!data || !reviewTargetDayId || !reviewText.trim()) return;
    const timestamp = nowIso();
    setData({ ...data, reviews: [...data.reviews, { id: id(), dayId: reviewTargetDayId, content: reviewText.trim(), createdAt: timestamp, updatedAt: timestamp }] });
    setReviewText(""); toast.success("复盘已保存");
  }
  function addStandardItem() {
    if (!data) return;
    const next = { id: id(), title: "新项目", durationMinutes: 60, color: COLORS[data.standard.items.length % COLORS.length] };
    setData({ ...data, standard: { enabled: true, items: [...data.standard.items, next], updatedAt: nowIso() } });
  }
  function updateStandardItem(itemId: string, patch: Partial<StandardItem>) {
    if (!data) return;
    setData({ ...data, standard: { ...data.standard, items: data.standard.items.map((item) => item.id === itemId ? { ...item, ...patch } : item), updatedAt: nowIso() } });
  }
  async function exportData() {
    if (!data) return;
    const fileName = `时间环记-${new Date().toISOString().slice(0, 10)}.json`;
    const contents = JSON.stringify({ ...data, exportedAt: nowIso() }, null, 2);
    if (Capacitor.isNativePlatform()) {
      try {
        const backup = await Filesystem.writeFile({ path: fileName, data: contents, directory: Directory.Cache, encoding: Encoding.UTF8 });
        await Share.share({ title: "时间环记备份", files: [backup.uri], dialogTitle: "保存或分享备份" });
        toast.success("备份已生成");
      } catch {
        toast.error("备份未导出");
      }
      return;
    }
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url); toast.success("完整数据已导出");
  }
  async function importData(file: File) {
    if (!data) return;
    try {
      const incoming = JSON.parse(await file.text()) as AppData;
      if (incoming.schemaVersion !== 1 || !Array.isArray(incoming.days) || !Array.isArray(incoming.events)) throw new Error();
      const merged: AppData = { ...data, days: mergeById(data.days, incoming.days), events: mergeById(data.events, incoming.events), reviews: mergeById(data.reviews, incoming.reviews ?? []), standard: new Date(incoming.standard?.updatedAt ?? 0) > new Date(data.standard.updatedAt) ? incoming.standard : data.standard };
      setData(merged);
      const latest = [...merged.days].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)).at(-1);
      setSelectedDayId(latest?.id ?? null); setReviewTargetDayId(latest?.id ?? null); toast.success("数据已合并，重复记录已忽略");
    } catch { toast.error("无法识别这个数据文件") }
  }

  if (!data) return <main className="app-shell loading-state">正在打开时间环记…</main>;
  const activeTheme = theme ?? "original";
  const selectedEvents = selectedDay ? activeEvents.filter((event) => event.dayId === selectedDay.id).sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)) : [];

  return <main className="app-shell">
    <header className="app-header">
      <div className="brand">
        <button className="brand-mark theme-toggle" onClick={() => setTheme((current) => (current ?? "original") === "original" ? "soft" : "original")} aria-label={activeTheme === "original" ? "切换到柔和浅色" : "切换到原色系"} title={activeTheme === "original" ? "切换到柔和浅色" : "切换到原色系"}>{activeTheme === "original" ? <MoonStar size={19} /> : <Sun size={19} />}</button>
        <button className="brand-home" onClick={() => setTab("today")}>时间环记</button>
      </div>
      <div className="header-actions">
        <Button variant="ghost" size="sm" onClick={exportData}><Download />导出</Button>
        <Button variant="ghost" size="sm" onClick={() => importRef.current?.click()}><FileUp />导入</Button>
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) importData(file); event.target.value = "" }} />
      </div>
    </header>
    <Tabs value={tab} onValueChange={setTab} className="main-tabs">
      <TabsList className="top-tabs" variant="line"><TabsTrigger value="today">今日</TabsTrigger><TabsTrigger value="review">复盘</TabsTrigger></TabsList>
      <TabsContent value="today" className="today-view">
        {selectedDay ? <>
          <section className="date-nav">
            <Button variant="ghost" size="icon" disabled={selectedIndex === 0} onClick={() => setSelectedDayId(sortedDays[selectedIndex - 1]?.id)} aria-label="前一个记录日"><ArrowLeft /></Button>
            <button className="date-title"><span>{fmtDate(selectedDay.startAt)} · 周{fmtWeekday(selectedDay.startAt)}</span><small>{fmtTime(selectedDay.startAt)} 入睡后</small></button>
            <Button variant="ghost" size="icon" disabled={selectedIndex === sortedDays.length - 1} onClick={() => setSelectedDayId(sortedDays[selectedIndex + 1]?.id)} aria-label="后一个记录日"><ArrowRight /></Button>
          </section>
          <section className="ring-stage">
            {data.standard.enabled && data.standard.items.length > 0 ? <button className="standard-corner" onClick={() => setStandardDialog(true)} aria-label="查看标准日程"><StandardRing items={data.standard.items} theme={activeTheme} /></button> : <button className="add-standard" onClick={() => setStandardDialog(true)}><CirclePlus size={16} />添加标准盘</button>}
            <DayRing day={selectedDay} events={selectedEvents} onSelect={openEvent} theme={activeTheme} />
          </section>
          <section className="today-actions">
            <Button className="record-button" onClick={openNewEvent}><Plus />记录一个刻度</Button>
            {selectedIndex === sortedDays.length - 1 && <Button variant="outline" onClick={() => { setSleepStart(toDateTimeLocal()); setNewDayDialog(true) }}><MoonStar />下一次睡觉</Button>}
          </section>
          <section className="event-list">
            <div className="section-heading"><h2>这一天的记录</h2><span>{selectedEvents.length}条</span></div>
            {selectedEvents.length ? selectedEvents.map((event) => <button key={event.id} className="event-row" onClick={() => openEvent(event)}><i style={{ background: displayColor(event.color, activeTheme) }} /><span className="event-time">{fmtTime(event.startAt)}{event.endAt ? `—${fmtTime(event.endAt)}` : ""}</span><span className="event-copy"><strong>{event.title}</strong>{event.content && <small>{event.content}</small>}</span><ChevronDown size={16} /></button>) : <p className="empty-copy">点击“记录一个刻度”，写下现在正在发生的事。</p>}
          </section>
        </> : <section className="first-day"><MoonStar size={30} /><h1>从一次入睡开始</h1><p>填写入睡时间，建立第一条记录日。</p><Button onClick={() => setNewDayDialog(true)}>开始记录</Button></section>}
      </TabsContent>
      <TabsContent value="review" className="review-view">
        <div className="review-toolbar"><div><p className="eyebrow">最近14个记录日</p><h1>{reviewDays.length ? `${fmtDate(reviewDays[0].startAt)}—${fmtDate(reviewDays.at(-1)!.startAt)}` : "暂无记录"}</h1></div>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline"><Archive />复盘记录<ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64">
            {[...new Set(activeReviews.map((review) => review.dayId))].map((dayId) => { const day = sortedDays.find((item) => item.id === dayId); return day ? <DropdownMenuItem key={dayId} onClick={() => setReviewTargetDayId(dayId)}>{fmtDate(day.startAt)}的复盘</DropdownMenuItem> : null })}
            {!activeReviews.length && <DropdownMenuItem disabled>还没有保存过复盘</DropdownMenuItem>}<DropdownMenuSeparator /><DropdownMenuItem onClick={() => setReviewTargetDayId(sortedDays.at(-1)?.id ?? null)}>回到最近14天</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
        </div>
        <div className="review-list">{reviewDays.map((day) => <DayStrip key={day.id} day={day} events={activeEvents.filter((event) => event.dayId === day.id)} reviews={activeReviews.filter((review) => review.dayId === day.id)} theme={activeTheme} />)}</div>
        {reviewTargetDayId && <section className="review-editor"><Label htmlFor="review-text">写下这次复盘</Label><Textarea id="review-text" value={reviewText} onChange={(event) => setReviewText(event.target.value)} placeholder="自由写下你看到的、想到的，或下一步想调整的事……" rows={7} /><Button onClick={saveReview} disabled={!reviewText.trim()}><Save />保存复盘</Button></section>}
      </TabsContent>
    </Tabs>

    <Dialog open={newDayDialog} onOpenChange={(open) => { if (sortedDays.length) setNewDayDialog(open) }}><DialogContent><DialogHeader><DialogTitle>{sortedDays.length ? "开始新的记录日" : "先记录入睡时间"}</DialogTitle><DialogDescription>第一条题目固定为“睡觉”。下一次睡觉会结束当前记录日。</DialogDescription></DialogHeader><div className="form-stack"><Label htmlFor="sleep-start">入睡时间</Label><Input id="sleep-start" type="datetime-local" value={sleepStart} onChange={(event) => setSleepStart(event.target.value)} /></div><DialogFooter><Button onClick={createDay}><MoonStar />开始这一天</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={eventDialog} onOpenChange={setEventDialog}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingEvent ? "编辑记录" : "记录一个刻度"}</DialogTitle><DialogDescription>{editingEvent ? "结束时间可以稍后补充；未填写时只显示一个刻度。" : "先记录发生的时间和文字。"}</DialogDescription></DialogHeader><div className="form-stack"><Label htmlFor="event-time">时间</Label><Input id="event-time" type="datetime-local" value={eventStart} onChange={(event) => setEventStart(event.target.value)} /><Label htmlFor="event-title">题目</Label><Input id="event-title" value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder="做了什么" /><Label id="event-color-label">颜色</Label><div className="event-color-picker" role="radiogroup" aria-labelledby="event-color-label">{COLORS.map((color, index) => <button key={color} type="button" role="radio" aria-checked={eventColor === color} aria-label={`颜色 ${index + 1}`} className={eventColor === color ? "selected" : ""} style={{ background: displayColor(color, activeTheme) }} onClick={() => setEventColor(color)} />)}</div><Label htmlFor="event-content">内容</Label><Textarea id="event-content" value={eventContent} onChange={(event) => setEventContent(event.target.value)} placeholder="可以留空" rows={4} />{editingEvent && <><Label htmlFor="event-end">结束时间</Label><div className="end-time-row"><Input id="event-end" type="datetime-local" value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} />{eventEnd && <Button variant="ghost" size="icon" onClick={() => setEventEnd("")} aria-label="清除结束时间"><X /></Button>}</div></>}</div><DialogFooter className="items-center sm:justify-between">{editingEvent ? <Button variant="ghost" className="text-red-600" onClick={deleteEvent}><Trash2 />删除</Button> : <span />}<Button onClick={saveEvent} disabled={!eventTitle.trim() || !eventStart}><Save />保存</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={standardDialog} onOpenChange={setStandardDialog}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>标准日程</DialogTitle><DialogDescription>只填写内容和时间长度，标准盘不会生成实际记录。</DialogDescription></DialogHeader>{data.standard.items.length > 0 && <div className="standard-preview"><StandardRing items={data.standard.items} theme={activeTheme} /></div>}<div className="standard-list">{data.standard.items.map((item) => <div key={item.id} className="standard-item"><span className="color-dot" style={{ background: displayColor(item.color, activeTheme) }} /><Input value={item.title} onChange={(event) => updateStandardItem(item.id, { title: event.target.value })} aria-label="项目名称" /><Input type="number" min="0.5" step="0.5" value={item.durationMinutes / 60} onChange={(event) => updateStandardItem(item.id, { durationMinutes: Math.max(30, Number(event.target.value) * 60) })} aria-label="持续小时数" /><span>小时</span><Button variant="ghost" size="icon" onClick={() => setData({ ...data, standard: { ...data.standard, items: data.standard.items.filter((entry) => entry.id !== item.id), updatedAt: nowIso() } })} aria-label="删除项目"><Trash2 /></Button></div>)}</div><Button variant="outline" onClick={addStandardItem}><Plus />添加一项</Button><DialogFooter className="sm:justify-between"><Button variant="ghost" onClick={() => { setData({ ...data, standard: { ...data.standard, enabled: false, updatedAt: nowIso() } }); setStandardDialog(false) }}>隐藏标准盘</Button><Button onClick={() => { setData({ ...data, standard: { ...data.standard, enabled: data.standard.items.length > 0, updatedAt: nowIso() } }); setStandardDialog(false); toast.success("标准盘已保存") }}><Save />保存</Button></DialogFooter></DialogContent></Dialog>
    <Toaster position="top-center" />
  </main>;
}

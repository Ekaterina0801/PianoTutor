"use client";
import { useEffect, useState } from "react";
import type { NoteEvent } from "@/lib/types";

export function MidiConnect({ onNote }: { onNote: (evt: NoteEvent, isOn: boolean) => void; }) {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState("Не подключено");

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && "requestMIDIAccess" in navigator);
  }, []);

  const connect = async () => {
    try {
      // @ts-ignore
      const access = await navigator.requestMIDIAccess();
      const inputs = Array.from(access.inputs.values());
      if (inputs.length === 0) { setStatus("MIDI-входы не найдены"); return; }
      const input = inputs[0];
      setStatus("Подключено: " + (input.name || "MIDI-устройство"));
      input.onmidimessage = (msg: any) => {
        const [sb, d1, d2] = msg.data as number[];
        const cmd = sb & 0xf0;
        const note = d1;
        const vel = d2;
        const now = performance.now()/1000;
        if (cmd === 0x90 && vel > 0) onNote({onset_s: now, offset_s: now, midi_note: note, velocity: vel}, true);
        else if (cmd === 0x80 || (cmd===0x90 && vel===0)) onNote({onset_s: now, offset_s: now, midi_note: note, velocity: vel}, false);
      };
    } catch {
      setStatus("Не удалось подключить");
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">MIDI</div>
          <div className="text-xs text-zinc-300">{supported ? status : "Web MIDI не поддерживается"}</div>
        </div>
        <button onClick={connect} disabled={!supported} className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50">Подключить</button>
      </div>
    </div>
  );
}

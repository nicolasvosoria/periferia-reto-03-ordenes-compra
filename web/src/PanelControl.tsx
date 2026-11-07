import { useEffect, useState } from 'react';

interface Resumen {
  intentos: number;
  solicitudes: number;
  ocCreadas: number;
  bloqueadas: number;
  pendientes: number;
  retroactivas: number;
  porcentajeRetroactivas: number;
  ultimas: { solicitud_id: string; resultado: string; numero_oc: string; retroactiva: boolean }[];
}

const ETIQUETAS: Record<string, string> = {
  creada: '✅ creada',
  idempotente: '♻️ ya existía',
  bloqueada: '⛔ bloqueada',
  pendiente_confirmacion: '⚠️ pendiente',
};

export function PanelControl({ version }: { version: number }) {
  const [resumen, setResumen] = useState<Resumen | null>(null);

  useEffect(() => {
    let vigente = true;
    fetch('/api/control')
      .then((r) => (r.ok ? (r.json() as Promise<Resumen>) : null))
      .then((datos) => vigente && setResumen(datos))
      .catch(() => vigente && setResumen(null));
    return () => {
      vigente = false;
    };
  }, [version]);

  if (!resumen || resumen.intentos === 0) return null;

  return (
    <details className="panel-control" open>
      <summary>Log de control · {resumen.solicitudes} solicitudes procesadas</summary>
      <div className="indicadores">
        <div><strong>{resumen.ocCreadas}</strong><span>OC creadas</span></div>
        <div><strong>{resumen.bloqueadas}</strong><span>bloqueadas</span></div>
        <div><strong>{resumen.pendientes}</strong><span>pendientes</span></div>
        <div className="retro"><strong>{resumen.porcentajeRetroactivas} %</strong><span>retroactivas ({resumen.retroactivas})</span></div>
      </div>
      <ul className="ultimas">
        {resumen.ultimas.map((f, i) => (
          <li key={`${f.solicitud_id}-${i}`}>
            <code>{f.solicitud_id}</code> {ETIQUETAS[f.resultado] ?? f.resultado}
            {f.numero_oc && <> · OC {f.numero_oc}</>}
            {f.retroactiva && <span className="marca-retro">retroactiva</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

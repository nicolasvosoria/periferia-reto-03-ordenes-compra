import { describe, expect, it } from 'vitest';
import { resumirControl } from '../src/domain/control.ts';

const fila = (solicitud_id: string, resultado: string, numero_oc = '', retroactiva = false) => ({
  solicitud_id,
  resultado,
  numero_oc,
  retroactiva,
});

describe('resumen del log de control', () => {
  it('cuenta el último estado por solicitud y el % de retroactivas', () => {
    const r = resumirControl([
      fila('S1', 'creada', '4500000001'),
      fila('S2', 'bloqueada'),
      fila('S3', 'pendiente_confirmacion', '', true),
      fila('S3', 'creada', '4500000002', true),
      fila('S1', 'idempotente', '4500000001'),
    ]);
    expect(r).toMatchObject({ intentos: 5, solicitudes: 3, ocCreadas: 2, bloqueadas: 1, pendientes: 0, retroactivas: 1, porcentajeRetroactivas: 33 });
    expect(r.ultimas[0]).toMatchObject({ solicitud_id: 'S1', resultado: 'idempotente' });
  });

  it('sin intentos devuelve ceros', () => {
    expect(resumirControl([])).toMatchObject({ intentos: 0, solicitudes: 0, porcentajeRetroactivas: 0 });
  });
});

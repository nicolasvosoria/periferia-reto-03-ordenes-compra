import { describe, expect, it } from 'vitest';
import { crearLimitadorVentana, type LimitesChat } from '../src/server/limites.ts';
import { appDePrueba, mensajeUsuario as mensaje, postChat } from './apoyo.ts';

const app = (limites: Partial<LimitesChat>) => appDePrueba({ limites });

const conversacion = { id: 'c1', messages: [mensaje('hola')] };

describe('límites de /api/chat', () => {
  it('rechaza un body más grande que el máximo con 413', async () => {
    const respuesta = await postChat(app({ maxBytes: 1024 }), { id: 'c1', messages: [mensaje('x'.repeat(2048))] });
    expect(respuesta.status).toBe(413);
    expect((await respuesta.json()).error).toMatch(/demasiado larga/);
  });

  it('rechaza una conversación con demasiados mensajes con 413', async () => {
    const mensajes = Array.from({ length: 4 }, (_, i) => mensaje(`m${i}`));
    const respuesta = await postChat(app({ maxMensajes: 3 }), { id: 'c1', messages: mensajes });
    expect(respuesta.status).toBe(413);
  });

  it('limita las requests por IP con 429', async () => {
    const aplicacion = app({ requestsPorIpPorMinuto: 2 });
    const desde = { 'True-Client-IP': '203.0.113.7' };
    expect((await postChat(aplicacion, conversacion, desde)).status).toBe(200);
    expect((await postChat(aplicacion, conversacion, desde)).status).toBe(200);
    const bloqueada = await postChat(aplicacion, conversacion, desde);
    expect(bloqueada.status).toBe(429);
    expect((await bloqueada.json()).error).toMatch(/Espera un minuto/);
  });

  it('cada IP del borde tiene su propio cupo', async () => {
    const aplicacion = app({ requestsPorIpPorMinuto: 1 });
    expect((await postChat(aplicacion, conversacion, { 'True-Client-IP': '203.0.113.1' })).status).toBe(200);
    expect((await postChat(aplicacion, conversacion, { 'True-Client-IP': '203.0.113.2' })).status).toBe(200);
  });

  it('ignora X-Forwarded-For: falsificarlo no da cupo nuevo', async () => {
    const aplicacion = app({ requestsPorIpPorMinuto: 1 });
    const borde = { 'True-Client-IP': '203.0.113.9' };
    expect((await postChat(aplicacion, conversacion, { ...borde, 'X-Forwarded-For': '1.1.1.1' })).status).toBe(200);
    expect((await postChat(aplicacion, conversacion, { ...borde, 'X-Forwarded-For': '2.2.2.2' })).status).toBe(429);
  });

  it('usa CF-Connecting-IP cuando falta True-Client-IP', async () => {
    const aplicacion = app({ requestsPorIpPorMinuto: 1 });
    const desde = { 'CF-Connecting-IP': '198.51.100.4' };
    expect((await postChat(aplicacion, conversacion, desde)).status).toBe(200);
    expect((await postChat(aplicacion, conversacion, desde)).status).toBe(429);
  });

  it('corta al agotar el presupuesto diario global con 429', async () => {
    const aplicacion = app({ requestsDiarias: 1 });
    expect((await postChat(aplicacion, conversacion, { 'True-Client-IP': '203.0.113.1' })).status).toBe(200);
    const agotada = await postChat(aplicacion, conversacion, { 'True-Client-IP': '203.0.113.2' });
    expect(agotada.status).toBe(429);
    expect((await agotada.json()).error).toMatch(/límite de uso diario/);
  });

  it('una request inválida no gasta presupuesto diario', async () => {
    const aplicacion = app({ requestsDiarias: 1 });
    expect((await postChat(aplicacion, { id: 'c1', messages: [] })).status).toBe(400);
    expect((await postChat(aplicacion, conversacion)).status).toBe(200);
  });
});

describe('limitador de ventana', () => {
  it('reinicia el cupo cuando vence la ventana', () => {
    let t = 0;
    const limitador = crearLimitadorVentana({ maximo: 1, ventanaMs: 1000, maxClaves: 10, ahora: () => t });
    expect(limitador.consumir('a')).toBe(true);
    expect(limitador.consumir('a')).toBe(false);
    t = 1000;
    expect(limitador.consumir('a')).toBe(true);
  });

  it('nunca rastrea más claves que su tope', () => {
    const limitador = crearLimitadorVentana({ maximo: 5, ventanaMs: 60_000, maxClaves: 100, ahora: () => 0 });
    for (let i = 0; i < 1000; i++) limitador.consumir(`ip-${i}`);
    expect(limitador.clavesRastreadas).toBeLessThanOrEqual(100);
  });

  it('libera primero las ventanas vencidas', () => {
    let t = 0;
    const limitador = crearLimitadorVentana({ maximo: 1, ventanaMs: 1000, maxClaves: 2, ahora: () => t });
    limitador.consumir('vieja');
    t = 500;
    limitador.consumir('reciente');
    t = 1200;
    limitador.consumir('nueva');
    expect(limitador.consumir('reciente')).toBe(false);
  });
});

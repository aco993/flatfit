import { describe, expect, it } from 'vitest';
import { cluster, fromReading, PLAN_SCHEMA, placeBackdrop, planPrompt, tidyRooms } from '../../src/domain/planread';
import { openingProblems, overlaps } from '../../src/domain/geometry';
import { MODEL, planRequest, readResponse } from '../../src/ui/planai';
import type { Project } from '../../src/types';

/** What Claude would say about tests/e2e/fixtures/plan.png (a made-up 8 × 4.5 m two-room flat), with the
 *  few centimetres of slack a reading of a drawing has. */
const READING = {
  found: true,
  plan_box: { left: 100, top: 120, right: 900, bottom: 570 },
  rooms: [
    { type: 'living', name: 'Dnevna soba', x: 0, z: 0, w: 4.97, d: 4.5, open_to: -1 },
    { type: 'bedroom', name: 'Soba', x: 5.04, z: 0.02, w: 2.96, d: 4.49, open_to: -1 },
  ],
  openings: [
    { kind: 'window', room: 0, side: 'n', at: 2, width: 1.2 },
    { kind: 'door', room: 0, side: 'e', at: 3.2, width: 0.8 },
  ],
  notes: 'Only one dimension was written; the rest follows from it.',
};

describe('reading a plan picture', () => {
  it('lines up walls that almost meet', () => {
    const m = cluster([0, 4.97, 5.04, 8]);
    expect(m.get(4.97)).toBe(m.get(5.04));
    expect(m.get(0)).toBe(0);
    expect(m.get(8)).toBe(8);
    const t = tidyRooms([
      { type: 'living', x: 0, z: 0, w: 4.97, d: 4.5 },
      { type: 'bedroom', x: 5.04, z: 0.02, w: 2.96, d: 4.49 },
    ]);
    expect(overlaps(t.map((x, i) => ({ id: 'r' + i, ...x.room })))).toEqual([]);
    expect(t[0].room.x + t[0].room.w).toBe(t[1].room.x);
  });

  it('turns the answer into rooms that share walls, with the doors and windows on them', () => {
    const plan = fromReading(READING, 1000, 700)!;
    expect(plan.rooms.map(r => [r.type, r.name, r.x, r.z, r.w, r.d])).toEqual([
      ['living', 'Dnevna soba', 0, 0, 5, 4.5],
      ['bedroom', 'Soba', 5, 0, 3, 4.5],
    ]);
    expect(plan.openings).toHaveLength(2);
    const project: Project = {
      id: 'x',
      name: 'x',
      country: 'de',
      wallHeight: 2.6,
      rooms: plan.rooms,
      open: plan.open,
      openings: plan.openings,
    };
    expect(openingProblems(project).filter(p => p.endsWith(':nowall'))).toEqual([]);
    expect(plan.notes).toMatch(/dimension/);
  });

  it('lays the picture under the rooms so its outline matches them', () => {
    const plan = fromReading(READING, 1000, 700)!;
    // 800 px of a 1000 px picture are 8 m: the picture is 10 m wide, its outline starts 1 m in and 1.2 m down
    expect(placeBackdrop(plan, 0.7)).toEqual({ x: -1, z: -1.2, w: 10 });
  });

  it('keeps open-plan pairs, and drops what does not fit', () => {
    const plan = fromReading(
      {
        ...READING,
        rooms: [
          { type: 'kitchen', name: '', x: 0, z: 0, w: 3, d: 3, open_to: -1 },
          { type: 'dining', name: '', x: 3, z: 0, w: 3, d: 3, open_to: 0 },
          { type: 'garage', name: 'Garaža', x: 0, z: 3, w: 6, d: 3, open_to: 7 },
          { type: 'hall', name: 'tiny', x: 9, z: 9, w: 0.2, d: 2, open_to: -1 },
        ],
        openings: [
          { kind: 'window', room: 9, side: 'n', at: 1, width: 1 },
          { kind: 'skylight', room: 0, side: 'n', at: 1, width: 1 },
          { kind: 'door', room: 1, side: 'up', at: 1, width: 1 },
          { kind: 'window', room: 2, side: 's', at: 5.5, width: 9 },
        ],
      },
      1000,
      700,
    )!;
    expect(plan.rooms.map(r => r.type)).toEqual(['kitchen', 'dining', 'bedroom']);
    expect(plan.open).toEqual([['r1', 'r2']]);
    // only the last window survives, made to fit its 6 m wall
    expect(plan.openings).toEqual([{ id: 'o1', kind: 'window', room: 'r3', side: 's', at: 0.05, width: 5.9 }]);
  });

  it('says nothing was found rather than guessing', () => {
    expect(fromReading({ ...READING, found: false }, 1000, 700)).toBeNull();
    expect(fromReading({ found: true, rooms: [] }, 1000, 700)).toBeNull();
    expect(fromReading('rooms!', 1000, 700)).toBeNull();
    expect(fromReading(null, 1000, 700)).toBeNull();
  });

  it('asks for one flat and no personal details', () => {
    expect(planPrompt(1000, 700, '')).toMatch(/most complete one/);
    expect(planPrompt(1000, 700, 'flat 3')).toMatch(/read only one flat: flat 3/);
    expect(planPrompt(1000, 700, '')).toMatch(/personal details/);
  });
});

describe('the request to Claude', () => {
  const req = planRequest('AAAA', 'image/jpeg', 1000, 700, ' flat 3 ');
  it('sends the picture and the question to the current model, with a fallback if it declines', () => {
    expect(req.model).toBe(MODEL);
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toContain('server-side-fallback-2026-07-01');
    const [img, text] = req.messages[0].content;
    expect(img).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
    expect(text).toMatchObject({ type: 'text' });
    expect((text as { text: string }).text).toMatch(/flat 3\.?$/m);
  });

  it('asks for JSON in a schema the API accepts: closed objects, every field required', () => {
    expect(req.output_config.format.type).toBe('json_schema');
    const walk = (s: Record<string, unknown>) => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties as object).sort());
        for (const v of Object.values(s.properties as Record<string, Record<string, unknown>>)) walk(v);
      }
      if (s.type === 'array') walk(s.items as Record<string, unknown>);
      for (const k of ['minimum', 'maximum', 'minLength', 'maxLength']) expect(s).not.toHaveProperty(k);
    };
    walk(PLAN_SCHEMA as unknown as Record<string, unknown>);
  });

  it('reads the answer, a refusal and a cut-off answer', () => {
    const ok = readResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(READING) }] }, 1000, 700);
    expect(ok.ok && ok.plan.rooms).toHaveLength(2);
    expect(readResponse({ stop_reason: 'refusal', content: [] }, 1000, 700)).toEqual({ ok: false, why: 'refused' });
    expect(readResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"found":' }] }, 1000, 700)).toEqual({
      ok: false,
      why: 'cut',
    });
    expect(readResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sorry' }] }, 1000, 700)).toMatchObject({
      ok: false,
      why: 'failed',
    });
  });
});

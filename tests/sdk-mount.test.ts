import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const rendering = vi.hoisted(() => ({ create: vi.fn(), render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: rendering.create }));
import { LuminaSpreadsheet } from '../src/sdk';
class Host {
  className = 'customer';
  classList = {
    add: (name: string) => {
      this.className += ` ${name}`;
    },
  };
}
const instances: LuminaSpreadsheet[] = [];
function make(host: Host) {
  const grid = new LuminaSpreadsheet(host as unknown as HTMLElement);
  instances.push(grid);
  return grid;
}
beforeEach(() => {
  vi.stubGlobal('HTMLElement', Host);
  vi.resetAllMocks();
  rendering.create.mockReturnValue({ render: rendering.render, unmount: rendering.unmount });
});
afterEach(() => {
  instances.splice(0).forEach((grid) => grid.destroy());
  vi.unstubAllGlobals();
});
describe('SDK mount ownership', () => {
  it('rejects a second root on the same host without disturbing the first', () => {
    const host = new Host(),
      first = make(host);
    first.setCell('A1', 7);
    expect(() => make(host)).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(first.getValue('A1')).toBe(7);
    expect(rendering.create).toHaveBeenCalledOnce();
    expect(host.className).toBe('customer lumina-sdk');
  });
  it('allows mount-cleanup-mount and idempotent cleanup without releasing another instance', () => {
    const host = new Host(),
      first = make(host);
    first.destroy();
    expect(host.className).toBe('customer');
    const second = make(host);
    first.destroy();
    expect(() => make(host)).toThrow();
    second.setCell('A1', 9);
    expect(second.getValue('A1')).toBe(9);
    second.destroy();
    expect(rendering.unmount).toHaveBeenCalledTimes(2);
  });
  it.each(['create', 'render'] as const)(
    'rolls back ownership and host classes after %s failure',
    (phase) => {
      const host = new Host();
      rendering[phase].mockImplementationOnce(() => {
        throw new Error('mount failed');
      });
      expect(() => make(host)).toThrow('mount failed');
      expect(host.className).toBe('customer');
      expect(() => make(host)).not.toThrow();
    },
  );
  it('releases ownership even if renderer unmount throws', () => {
    const host = new Host(),
      first = make(host);
    rendering.unmount.mockImplementationOnce(() => {
      throw new Error('cleanup failed');
    });
    expect(() => first.destroy()).toThrow('cleanup failed');
    expect(host.className).toBe('customer');
    expect(() => make(host)).not.toThrow();
  });
  it('allows independent hosts to mount at the same time', () => {
    const a = make(new Host()),
      b = make(new Host());
    a.setCell('A1', 3);
    b.setCell('A1', 4);
    expect(a.getValue('A1')).toBe(3);
    expect(b.getValue('A1')).toBe(4);
  });
});

it('drops queued data notifications after destroy and a remounted instance starts idle', async () => {
  const host = new Host();
  const first = make(host);
  const dataHost = new Host();
  const states: unknown[] = [];
  const withState = new LuminaSpreadsheet(dataHost as unknown as HTMLElement, {
    onDataStateChange: (state) => states.push(state),
  });
  instances.push(withState);
  const pending = withState.bindData({
    columnCount: 1,
    rowCount: 1,
    fetchPage: () => new Promise(() => {}),
  });
  withState.destroy();
  await expect(pending).rejects.toHaveProperty('name', 'AbortError');
  await Promise.resolve();
  expect(states).toEqual([]);
  const next = make(dataHost);
  expect(next.dataSourceState).toMatchObject({ status: 'idle', cachedPages: 0, loading: 0 });
  expect(next.dataSourceStats).toBeNull();
  first.destroy();
});

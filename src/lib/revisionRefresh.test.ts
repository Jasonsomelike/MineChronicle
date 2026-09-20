import { expect, it, vi } from 'vitest';
import { revisionRefresh } from './revisionRefresh';

it('retries the same revision after failure and only skips committed data', async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(Error('busy'))
    .mockResolvedValue({ count: 2 });
  const apply = vi.fn();
  const refresh = revisionRefresh(load, apply);
  await expect(refresh(7)).rejects.toThrow('busy');
  expect(apply).not.toHaveBeenCalled();
  await refresh(7);
  await refresh(7);
  expect(load).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenCalledWith({ count: 2 });
  await refresh(8);
  expect(load).toHaveBeenCalledTimes(3);
});

it('does not commit null or data that failed to apply', async () => {
  const load = vi.fn().mockResolvedValueOnce(null).mockResolvedValue('archive');
  const apply = vi.fn().mockImplementationOnce(() => {
    throw Error('apply failed');
  });
  const refresh = revisionRefresh(load, apply);
  await expect(refresh(0)).rejects.toThrow('未返回数据');
  await expect(refresh(0)).rejects.toThrow('apply failed');
  await refresh(0);
  expect(load).toHaveBeenCalledTimes(3);
});

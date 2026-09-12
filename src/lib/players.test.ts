import { describe, it, expect } from 'vitest';
import { initialPlayers, selectedPlayer, playerOptions } from './players';
import type { ScanSummary } from './scan';
describe('player selection', () => {
  it('defaults to all players and distinguishes accounts with the same name', () => {
    const preferredPlayer = 'b0e9bd79-52ec-45c0-ad53-d92995098e1d';
    const report = {
      roots: [
        {
          worlds: [
            {
              players: [
                { uuid: 'another', preferred_name: 'Jasonsomelike' },
                { uuid: preferredPlayer, preferred_name: 'Jasonsomelike' },
                { uuid: 'jr', preferred_name: 'jr' },
              ],
            },
          ],
        },
      ],
    } as ScanSummary;
    expect(initialPlayers()).toEqual([]);
    expect(playerOptions(report)).toHaveLength(3);
    expect(selectedPlayer('another', [preferredPlayer])).toBe(false);
    expect(selectedPlayer('jr', [preferredPlayer, 'jr'])).toBe(true);
    expect(selectedPlayer('any', [])).toBe(true);
  });
});

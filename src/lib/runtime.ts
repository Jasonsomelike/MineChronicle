import { invoke, isTauri } from '@tauri-apps/api/core';

export interface PhaseStatus {
  phase: number;
  offline: boolean;
  scanning_available: boolean;
}

export async function checkRuntime(): Promise<PhaseStatus | null> {
  if (!isTauri()) return null;
  return invoke<PhaseStatus>('phase_status');
}

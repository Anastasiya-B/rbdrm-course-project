import { getModuleBValue } from './module-b';

export function getModuleAValue(): string {
  return getModuleBValue();
}

import {readFileSync} from 'node:fs';

export interface IndiaState {code: string; name: string; cities: string[]}
export const indiaStates = JSON.parse(readFileSync(new URL('../data/india.json', import.meta.url), 'utf8')) as IndiaState[];
export function stateForCity(city: string): IndiaState | undefined {
  return indiaStates.find(state => state.cities.some(name => name.toLowerCase() === city.toLowerCase()));
}
export function validLocation(stateCode: string, city: string): boolean {
  const state = indiaStates.find(state => state.code === stateCode) || (!stateCode ? stateForCity(city) : undefined);
  return Boolean(state?.cities.includes(city));
}
export function citiesForState(code: string): string[] { return indiaStates.find(state => state.code === code)?.cities || []; }

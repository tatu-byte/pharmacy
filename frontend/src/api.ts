import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
export interface Rule { id: number; effective_from: string; effective_to: string | null; max_quantity_per_dispense: number; max_quantity_per_30_days: number; requires_authorisation: boolean; }
export interface Medicine { code: string; name: string; form: string; strength_value: string; strength_unit: string; is_active: boolean; current_rule?: Rule | null; }
export interface Dispense { id: number; medicine_code: string; patient_ref: string; quantity: number; dispensed_at: string; }
export interface Page<T> { data: T[]; next_cursor: string | null; }
export interface Violation { code: string; field: string; message: string; }
export function violations(e: HttpErrorResponse): Violation[] {
  return e.error?.error?.violations ?? [{code:'network_error', field:'', message:'Unable to reach the server. Retry when connected.'}];
}
@Injectable({providedIn:'root'})
export class Api {
  private http = inject(HttpClient);
  get<T>(path: string, values: Record<string, string | null> = {}) {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(values)) if (value !== null) params = params.set(key,value);
    return this.http.get<T>('/api/v1' + path, {params});
  }
  post<T>(path: string, body: unknown) { return this.http.post<T>('/api/v1' + path, body); }
}

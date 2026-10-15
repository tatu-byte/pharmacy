import { Component, DestroyRef, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api, Dispense, Violation, violations } from './api';
import { johannesburgNow, johannesburgToUtc } from './time';

type CaptureValues = { medicine_code: string; patient_ref: string; quantity: number; dispensed_at: string; authorisation_ref: string };
type Submission = { version: 1; key: string; values: CaptureValues; timestamp: string };
const STORAGE_KEY = 'pharmacy.pending-dispense.v1';
function validSubmission(value: unknown): value is Submission {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Submission>;
  if (p.version !== 1 || typeof p.key !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.key) || !p.values) return false;
  const v = p.values;
  if (![v.medicine_code, v.patient_ref, v.dispensed_at, v.authorisation_ref].every(x => typeof x === 'string')) return false;
  if (!v.medicine_code.trim() || v.medicine_code.length > 64 || !v.patient_ref.trim() || v.patient_ref.length > 128 || v.authorisation_ref.length > 200 || !Number.isInteger(v.quantity) || v.quantity <= 0 || v.quantity > 2147483647) return false;
  try { return johannesburgToUtc(v.dispensed_at) === p.timestamp; } catch { return false; }
}
@Component({standalone:true,imports:[ReactiveFormsModule,RouterLink],template:`
<h1>Capture dispense</h1><p>All date/time input is Johannesburg time (Africa/Johannesburg).</p>
@if(pending && !busy){<p role="status">The previous request is not yet confirmed. Retry it before starting another dispense.</p>}
<form [formGroup]="form" (ngSubmit)="submit()">
<fieldset [disabled]="busy || !!pending || !!success || storageBlocked">
<label for="medicine">Medicine code</label><input id="medicine" formControlName="medicine_code" required maxlength="64">
@for(e of forField('medicine_code');track $index){<p class="error">{{e.message}}</p>}
<label for="patient">Patient reference</label><input id="patient" formControlName="patient_ref" required maxlength="128">
@for(e of forField('patient_ref');track $index){<p class="error">{{e.message}}</p>}
<label for="quantity">Quantity</label><input id="quantity" type="number" formControlName="quantity" min="1" max="2147483647" step="1" required>
@for(e of forField('quantity');track $index){<p class="error">{{e.message}}</p>}
<label for="at">Dispensed at</label><input id="at" type="datetime-local" step="1" formControlName="dispensed_at" required>
@for(e of forField('dispensed_at');track $index){<p class="error">{{e.message}}</p>}
<label for="auth">Authorisation reference (if required)</label><input id="auth" formControlName="authorisation_ref" maxlength="200">
@for(e of forField('authorisation_ref');track $index){<p class="error">{{e.message}}</p>}
</fieldset>
<button type="submit" [disabled]="form.invalid || busy || !!success || storageBlocked">{{busy ? 'Submitting…' : pending ? 'Retry pending dispense' : 'Submit dispense'}}</button>
</form>
@if(errors.length){<div role="alert"><h2>Dispense not confirmed</h2><ul>@for(e of errors;track $index){<li>{{e.field || 'Request'}}: {{e.message}}</li>}</ul></div>}
@if(success){<p role="status">Dispense #{{success.id}} recorded.</p><a routerLink="/ledger" [queryParams]="{patient:success.patient_ref}">View patient ledger</a><button (click)="newAttempt()">New dispense</button>}
<p class="muted">Pending requests are kept in this browser tab so refresh and retry use the same request key. Keep the tab open until the result is confirmed.</p>`})
export class Capture {
  private api = inject(Api);
  private fb = inject(FormBuilder);
  private destroy = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  key = crypto.randomUUID(); busy = false; storageBlocked = false;
  errors: Violation[] = []; success?: Dispense; pending?: Submission;
  form = this.fb.nonNullable.group({
    medicine_code: [this.route.snapshot.queryParamMap.get('medicine') ?? '', [Validators.required, Validators.maxLength(64), Validators.pattern(/\S/)]],
    patient_ref: ['', [Validators.required, Validators.maxLength(128), Validators.pattern(/\S/)]],
    quantity: [1, [Validators.required, Validators.min(1), Validators.max(2147483647), (control: AbstractControl) => Number.isInteger(control.value) ? null : {integer: true}]],
    dispensed_at: [johannesburgNow(), Validators.required], authorisation_ref: ['', Validators.maxLength(200)],
  });
  constructor() {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (!validSubmission(parsed)) throw new Error('Invalid pending request');
        this.pending = parsed; this.key = parsed.key as typeof this.key;
        this.form.setValue(parsed.values);
      }
    } catch {
      this.storageBlocked = true;
      this.errors = [{code:'pending_storage',field:'',message:'Pending request storage cannot be read. Check the ledger and browser tab storage before submitting again.'}];
    }
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroy)).subscribe(() => {
      if (!this.pending && !this.busy && !this.success) { this.key = crypto.randomUUID(); this.errors = []; }
    });
  }
  newAttempt() {
    if (this.pending || this.busy || this.storageBlocked) return;
    this.success = undefined; this.errors = []; this.key = crypto.randomUUID();
    this.form.reset({medicine_code:this.form.getRawValue().medicine_code,patient_ref:'',quantity:1,dispensed_at:johannesburgNow(),authorisation_ref:''});
  }
  forField(field: string) { return this.errors.filter(e => e.field === field); }
  submit() {
    if (this.form.invalid || this.busy || this.success || this.storageBlocked) return;
    const values = this.form.getRawValue();
    if (!this.pending) {
      let timestamp: string;
      try { timestamp = johannesburgToUtc(values.dispensed_at); }
      catch (e) {
        this.errors = [{code:'invalid_local_time',field:'dispensed_at',message:e instanceof Error ? e.message : 'Enter a valid local time.'}];
        return;
      }
      const candidate: Submission = {version:1,key:this.key,values,timestamp};
      try {
        // Persist BEFORE sending. If storage fails, no request is made.
        sessionStorage.setItem(STORAGE_KEY,JSON.stringify(candidate));
        this.pending = candidate;
      } catch {
        this.errors = [{code:'storage_unavailable',field:'',message:'Browser tab storage is unavailable. Enable it before submitting so retries remain safe.'}];
        return;
      }
    }
    const pending = this.pending;
    this.busy = true; this.errors = [];
    this.api.post<{data:Dispense}>('/dispenses', {...pending.values,dispensed_at:pending.timestamp,authorisation_ref:pending.values.authorisation_ref || null,idempotency_key:pending.key})
      .pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: p => {
          this.success = p.data; this.busy = false;
          this.clearPending();
        },
        error: e => {
          this.errors = violations(e); this.busy = false;
          // A 5xx, transport error, or throttling may arrive after a lost successful
          // response on an earlier try. Preserve the exact payload until resolved.
          if ([409, 422].includes(e.status)) this.clearPending();
        },
      });
  }
  private clearPending() {
    try { sessionStorage.removeItem(STORAGE_KEY); this.pending = undefined; }
    catch { this.storageBlocked = true; }
  }
}

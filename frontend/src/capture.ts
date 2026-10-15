import { Component, DestroyRef, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api, Dispense, Violation, violations } from './api';
@Component({standalone:true,imports:[ReactiveFormsModule,RouterLink],template:`
<h1>Capture dispense</h1><p>All date/time input is Johannesburg time (UTC+02:00).</p>
<form [formGroup]="form" (ngSubmit)="submit()">
<fieldset [disabled]="busy">
<label for="medicine">Medicine code</label><input id="medicine" formControlName="medicine_code" required maxlength="64">
@for(e of forField('medicine_code');track $index){<p class="error">{{e.message}}</p>}
<label for="patient">Patient reference</label><input id="patient" formControlName="patient_ref" required maxlength="128">
@for(e of forField('patient_ref');track $index){<p class="error">{{e.message}}</p>}
<label for="quantity">Quantity</label><input id="quantity" type="number" formControlName="quantity" min="1" step="1" required>
@for(e of forField('quantity');track $index){<p class="error">{{e.message}}</p>}
<label for="at">Dispensed at</label><input id="at" type="datetime-local" formControlName="dispensed_at" required>
@for(e of forField('dispensed_at');track $index){<p class="error">{{e.message}}</p>}
<label for="auth">Authorisation reference (if required)</label><input id="auth" formControlName="authorisation_ref" maxlength="200">
@for(e of forField('authorisation_ref');track $index){<p class="error">{{e.message}}</p>}
<button type="submit" [disabled]="form.invalid || busy || !!success">{{busy ? 'Submitting…' : 'Submit dispense'}}</button>
</fieldset></form>
@if(errors.length){<div role="alert"><h2>Dispense not confirmed</h2><ul>@for(e of errors;track $index){<li>{{e.field || 'Request'}}: {{e.message}}</li>}</ul></div>}
@if(success){<p role="status">Dispense #{{success.id}} recorded.</p><a routerLink="/ledger" [queryParams]="{patient:success.patient_ref}">View patient ledger</a><button (click)="newAttempt()">New dispense</button>}
<p class="muted">Retries keep the same request key. Editing a field starts a new request.</p>`})
export class Capture {
  private api=inject(Api); private fb=inject(FormBuilder);private destroy=inject(DestroyRef);private route=inject(ActivatedRoute);
  key=crypto.randomUUID();busy=false;errors:Violation[]=[];success?:Dispense;
  form=this.fb.nonNullable.group({medicine_code:[this.route.snapshot.queryParamMap.get('medicine')??'',Validators.required],patient_ref:['',Validators.required],quantity:[1,[Validators.required,Validators.min(1)]],dispensed_at:[new Date(Date.now()+7200000).toISOString().slice(0,16),Validators.required],authorisation_ref:['']});
  constructor(){this.form.valueChanges.pipe(takeUntilDestroyed(this.destroy)).subscribe(()=>this.newAttempt());}
  newAttempt(){this.key=crypto.randomUUID();this.errors=[];this.success=undefined;}
  forField(field:string){return this.errors.filter(e=>e.field===field);}
  submit(){if(this.form.invalid||this.busy||this.success)return;
    const value=this.form.getRawValue();this.busy=true;this.errors=[];
    this.api.post<{data:Dispense}>('/dispenses',{...value,dispensed_at:value.dispensed_at+':00+02:00',authorisation_ref:value.authorisation_ref||null,idempotency_key:this.key}).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next:p=>{this.success=p.data;this.busy=false;},error:e=>{this.errors=violations(e);this.busy=false;}
    });
  }
}

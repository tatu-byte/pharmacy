import { Component, DestroyRef, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { Api, Dispense, Page, violations } from './api';
@Component({standalone:true,imports:[FormsModule,DatePipe],template:`
<h1>Patient ledger</h1><form (ngSubmit)="search()"><label for="patient">Patient reference</label><input id="patient" name="patient" [(ngModel)]="patient" required maxlength="128"><label for="medicine">Medicine code (optional)</label><input id="medicine" name="medicine" [(ngModel)]="medicine" maxlength="64"><button [disabled]="!patient.trim()">Load ledger</button></form>
@if(loading){<p role="status">Loading…</p>} @if(error){<p role="alert">{{error}} <button type="button" (click)="load(current)">Retry current page</button></p>}
@if(searched && !loading && !error && !rows.length){<p>No dispenses found.</p>}
<p>Newest first. Johannesburg time (UTC+02:00).</p>
<table><thead><tr><th>Date</th><th>Medicine</th><th>Quantity</th><th>Record</th></tr></thead><tbody>
@for(d of rows;track d.id){<tr><td>{{d.dispensed_at | date:'medium':'+0200'}}</td><td>{{d.medicine_code}}</td><td>{{d.quantity}}</td><td>#{{d.id}}</td></tr>}</tbody></table>
<div class="pager"><button (click)="previous()" [disabled]="loading || !history.length">Previous</button><button (click)="advance()" [disabled]="loading || !next">Next</button></div>`})
export class Ledger {
 private api=inject(Api);private route=inject(ActivatedRoute);private destroy=inject(DestroyRef);private request?:Subscription;
 patient=this.route.snapshot.queryParamMap.get('patient')??'';medicine='';appliedPatient='';appliedMedicine='';rows:Dispense[]=[];history:(string|null)[]=[];current:string|null=null;next:string|null=null;loading=false;error='';searched=false;
 constructor(){if(this.patient)this.search();}
 search(){if(!this.patient.trim())return;this.appliedPatient=this.patient;this.appliedMedicine=this.medicine;this.history=[];this.rows=[];this.next=null;this.current=null;this.searched=true;this.load(null);}
 advance(){if(this.next){this.load(this.next,[...this.history,this.current]);}}
 previous(){this.load(this.history.at(-1)??null,this.history.slice(0,-1));}
 load(cursor:string|null, history=this.history){this.request?.unsubscribe();this.loading=true;this.error='';
 this.request=this.api.get<Page<Dispense>>('/dispenses',{patient_ref:this.appliedPatient,medicine:this.appliedMedicine||null,cursor}).pipe(takeUntilDestroyed(this.destroy)).subscribe({next:p=>{this.current=cursor;this.history=history;this.rows=p.data;this.next=p.next_cursor;this.loading=false;},error:e=>{this.error=violations(e).map(v=>v.message).join(' ');this.loading=false;}});}
}

import { Component, DestroyRef, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { Api, Medicine, Page, violations } from './api';
@Component({standalone:true, imports:[FormsModule,RouterLink], template:`
<h1>Medicine search</h1>
<form (ngSubmit)="search()"><label for="query">Name or code</label><input id="query" name="query" [(ngModel)]="query" maxlength="100"><button type="submit">Search</button></form>
@if (loading) {<p role="status">Loading medicines…</p>}
@if (error) {<p role="alert">{{error}}</p>}
@if (!loading && !error && !rows.length) {<p>No medicines found. Seed the catalogue if this is a new installation.</p>}
<table><thead><tr><th>Code</th><th>Name</th><th>Strength</th><th>Status</th></tr></thead><tbody>
@for (m of rows; track m.code) {<tr><td><a [routerLink]="['/medicines',m.code]">{{m.code}}</a></td><td>{{m.name}}</td><td>{{m.strength_value}} {{m.strength_unit}}</td><td>{{m.is_active ? 'Active' : 'Inactive'}}</td></tr>}
</tbody></table><div class="pager"><button (click)="previous()" [disabled]="loading || !history.length">Previous</button><button (click)="advance()" [disabled]="loading || !next">Next</button></div>`})
export class Search {
  private api=inject(Api); private destroy=inject(DestroyRef); private request?: Subscription;
  query=''; applied=''; rows:Medicine[]=[]; next:string|null=null; current:string|null=null; history:(string|null)[]=[]; loading=false; error='';
  constructor() {this.load(null);}
  search() {this.applied=this.query; this.history=[]; this.load(null);}
  advance() {if(this.next) {this.history.push(this.current);this.load(this.next);}}
  previous() {this.load(this.history.pop() ?? null);}
  load(cursor:string|null) {
    this.request?.unsubscribe(); this.loading=true; this.error=''; this.rows=[]; this.next=null; this.current=cursor;
    this.request=this.api.get<Page<Medicine>>('/medicines',{q:this.applied,cursor}).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next:p=>{this.rows=p.data;this.next=p.next_cursor;this.loading=false;},
      error:e=>{this.error=violations(e).map(v=>v.message).join(' ');this.loading=false;}
    });
  }
}

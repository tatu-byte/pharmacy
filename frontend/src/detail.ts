import { Component, DestroyRef, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap, Subscription } from 'rxjs';
import { Api, Medicine, Rule, Page, violations } from './api';
@Component({standalone:true,imports:[DatePipe,RouterLink],template:`
@if(error){<p role="alert">{{error}}</p>}
@if(medicine; as m){<h1>{{m.name}}</h1><p>{{m.code}} · {{m.form}} · {{m.strength_value}} {{m.strength_unit}}</p><p>{{m.is_active ? 'Active' : 'Inactive'}}</p>
<a routerLink="/capture" [queryParams]="{medicine:m.code}">Capture dispense</a>
<h2>Rule timeline</h2><p>Johannesburg time (UTC+02:00). End dates are exclusive.</p>
@if(!m.current_rule){<p>No rule is currently in force.</p>}
<ol class="timeline">@for(r of rules;track r.id){<li [class.current]="r.id === m.current_rule?.id">
<strong>{{r.effective_from | date:'medium':'+0200'}} → {{r.effective_to ? (r.effective_to | date:'medium':'+0200') : 'Open-ended'}}</strong>
@if(r.id === m.current_rule?.id){<span class="badge">In force now</span>}
<p>Per dispense: {{r.max_quantity_per_dispense}} · Per 30 days: {{r.max_quantity_per_30_days}} · Authorisation: {{r.requires_authorisation ? 'Required' : 'Not required'}}</p></li>}</ol>
@if(next){<button (click)="loadRules(next)" [disabled]="loading">Load older-to-newer history</button>}
@if(loading){<p role="status">Loading…</p>}
}`})
export class Detail {
  private api=inject(Api); private route=inject(ActivatedRoute); private destroy=inject(DestroyRef); private request?:Subscription;
  medicine?:Medicine; rules:Rule[]=[]; next:string|null=null; error=''; loading=false; code='';
  constructor(){this.route.paramMap.pipe(switchMap(params=>{
    this.request?.unsubscribe(); this.code=params.get('code')!; this.rules=[];this.next=null;this.medicine=undefined;this.error='';
    return this.api.get<{data:Medicine}>('/medicines/'+encodeURIComponent(this.code));
  }),takeUntilDestroyed(this.destroy)).subscribe({next:p=>{this.medicine=p.data;this.loadRules(null);},error:e=>this.error=violations(e).map(v=>v.message).join(' ')});}
  loadRules(cursor:string|null){this.loading=true;this.error='';this.request=this.api.get<Page<Rule>>('/medicines/'+encodeURIComponent(this.code)+'/rules',{cursor}).pipe(takeUntilDestroyed(this.destroy)).subscribe({
    next:p=>{this.rules=[...this.rules,...p.data];this.next=p.next_cursor;this.loading=false;},error:e=>{this.error=violations(e).map(v=>v.message).join(' ');this.loading=false;}
  });}
}

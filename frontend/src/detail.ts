import { Component, DestroyRef, inject } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  switchMap,
  Subscription,
  catchError,
  EMPTY,
  Subject,
  startWith,
} from "rxjs";
import { Api, Medicine, Rule, Page, violations } from "./api";
import { LocalDate } from "./local-date";
@Component({
  standalone: true,
  imports: [LocalDate, RouterLink],
  template: ` <p class="breadcrumb">
      <a routerLink="/medicines">← Back to medicines</a>
    </p>
    @if (medicineLoading) {
      <p class="loading" role="status">Loading medicine…</p>
    }
    @if (error) {
      <div class="notice danger" role="alert">
        <h2>Medicine could not be loaded</h2>
        <p>{{ error }}</p>
        <button class="secondary" (click)="retryMedicine()">
          Retry medicine
        </button>
      </div>
    }
    @if (medicine; as m) {
      <div class="page-heading">
        <div>
          <p class="eyebrow">Medicine details</p>
          <h1>{{ m.name }}</h1>
          <p class="subtitle">
            {{ m.code }} · {{ m.form }} · {{ m.strength_value }}
            {{ m.strength_unit }}
          </p>
        </div>
        <a
          class="button"
          routerLink="/capture"
          [queryParams]="{ medicine: m.code }"
          >Capture dispense <span aria-hidden="true">+</span></a
        >
      </div>
      @if (!m.is_active) {
        <div class="notice warning">
          <strong>This medicine is inactive.</strong> Its rules remain available
          for reference, but new dispenses will be rejected.
        </div>
      }
      <div class="detail-grid">
        @if (m.current_rule; as current) {
          <section
            class="card rule-summary"
            aria-label="Current formulary rule"
          >
            <div class="card-title">
              <div>
                <h2>Current formulary rule</h2>
                <p>Effective from {{ current.effective_from | localDate }}</p>
              </div>
              <span class="status" [class.inactive]="!m.is_active">{{
                m.is_active ? "Active medicine" : "Inactive medicine"
              }}</span>
            </div>
            <div class="metrics">
              <div class="metric">
                <span>Maximum per dispense</span
                ><strong>{{ current.max_quantity_per_dispense }}</strong>
              </div>
              <div class="metric">
                <span>Maximum per 30 days</span
                ><strong>{{ current.max_quantity_per_30_days }}</strong>
              </div>
              <div class="metric">
                <span>Authorisation</span
                ><strong class="small">{{
                  current.requires_authorisation ? "Required" : "Not required"
                }}</strong>
              </div>
            </div>
            <p class="rule-footnote">
              Backdated dispenses use the rule in effect at the time of the
              dispense.
            </p>
          </section>
        } @else {
          <div class="notice warning">
            <h2>No rule is currently in force</h2>
            <p>
              A dispense can only be recorded if a rule applies at its event
              time. Check the history below.
            </p>
          </div>
        }
        <section class="card" aria-label="Rule history">
          <div class="card-title">
            <div>
              <h2>Rule timeline</h2>
              <p>Oldest to newest · Johannesburg time</p>
            </div>
            <span>End times are exclusive</span>
          </div>
          @if (historyFailed) {
            <div class="notice danger inline-notice" role="alert">
              <p>{{ historyError }}</p>
              <button class="secondary" (click)="loadRules(failedCursor)">
                Retry rule history
              </button>
            </div>
          }
          <ol class="timeline">
            @for (r of rules; track r.id) {
              <li [class.current]="r.id === m.current_rule?.id">
                <div class="timeline-head">
                  <strong class="timeline-period"
                    >{{ r.effective_from | localDate }}
                    <span
                      >to
                      {{
                        r.effective_to
                          ? (r.effective_to | localDate)
                          : "open-ended"
                      }}</span
                    ></strong
                  >
                  @if (r.id === m.current_rule?.id) {
                    <span class="status">In force now</span>
                  }
                </div>
                <div class="timeline-limits">
                  <span
                    ><strong>{{ r.max_quantity_per_dispense }}</strong> per
                    dispense</span
                  ><span
                    ><strong>{{ r.max_quantity_per_30_days }}</strong> per 30
                    days</span
                  ><span
                    >Authorisation
                    <strong>{{
                      r.requires_authorisation ? "required" : "not required"
                    }}</strong></span
                  >
                </div>
              </li>
            }
          </ol>
          @if (!loading && !historyFailed && !rules.length) {
            <div class="empty">
              <h2>No rules recorded</h2>
              <p>This medicine has no formulary history yet.</p>
            </div>
          }
          @if (loading) {
            <p class="loading" role="status">Loading rule history…</p>
          }
          @if (next && !historyFailed) {
            <div class="history-footer">
              <button
                class="secondary"
                (click)="loadRules(next)"
                [disabled]="loading"
              >
                Load more rules
              </button>
            </div>
          }
        </section>
      </div>
    }`,
})
export class Detail {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private destroy = inject(DestroyRef);
  private request?: Subscription;
  private reload = new Subject<void>();
  medicine?: Medicine;
  rules: Rule[] = [];
  next: string | null = null;
  error = "";
  historyError = "";
  loading = false;
  medicineLoading = false;
  code = "";
  failedCursor: string | null = null;
  historyFailed = false;
  constructor() {
    this.route.paramMap
      .pipe(
        switchMap((params) => {
          this.code = params.get("code")!;
          return this.reload.pipe(
            startWith(undefined),
            switchMap(() => {
              this.request?.unsubscribe();
              this.rules = [];
              this.next = null;
              this.medicine = undefined;
              this.error = "";
              this.historyError = "";
              this.loading = false;
              this.historyFailed = false;
              this.medicineLoading = true;
              return this.api
                .get<{
                  data: Medicine;
                }>("/medicines/" + encodeURIComponent(this.code))
                .pipe(
                  catchError((e) => {
                    this.error = violations(e)
                      .map((v) => v.message)
                      .join(" ");
                    this.medicineLoading = false;
                    return EMPTY;
                  }),
                );
            }),
          );
        }),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe((p) => {
        this.medicine = p.data;
        this.medicineLoading = false;
        this.loadRules(null);
      });
  }
  retryMedicine() {
    this.reload.next();
  }
  loadRules(cursor: string | null) {
    if (this.loading) return;
    this.loading = true;
    this.historyFailed = false;
    this.failedCursor = cursor;
    this.historyError = "";
    this.request = this.api
      .get<Page<Rule>>(
        "/medicines/" + encodeURIComponent(this.code) + "/rules",
        { cursor },
      )
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (p) => {
          this.rules = [...this.rules, ...p.data];
          this.next = p.next_cursor;
          this.loading = false;
        },
        error: (e) => {
          this.historyError = violations(e)
            .map((v) => v.message)
            .join(" ");
          this.loading = false;
          this.historyFailed = true;
        },
      });
  }
}

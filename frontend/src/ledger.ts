import { Component, DestroyRef, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { Subscription } from "rxjs";
import { Api, Dispense, Page, violations } from "./api";
import { LocalDate } from "./local-date";
@Component({
  standalone: true,
  imports: [FormsModule, LocalDate, RouterLink],
  template: ` <div class="page-heading">
      <div>
        <p class="eyebrow">Dispense records</p>
        <h1>Patient ledger</h1>
        <p class="subtitle">
          Review a patient's recorded dispenses, with the latest events first.
        </p>
      </div>
    </div>
    <section class="card" aria-label="Patient dispense ledger">
      <form class="toolbar" (ngSubmit)="search()">
        <div class="field">
          <label for="patient">Patient reference</label
          ><input
            id="patient"
            name="patient"
            [(ngModel)]="patient"
            required
            maxlength="128"
            placeholder="Enter an opaque reference"
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label for="medicine"
            >Medicine code <span class="optional">(optional)</span></label
          ><input
            id="medicine"
            name="medicine"
            [(ngModel)]="medicine"
            maxlength="64"
            placeholder="All medicines"
            autocomplete="off"
          />
        </div>
        <button [disabled]="!patient.trim()">Load ledger</button>
      </form>
      @if (searched) {
        <div class="card-title">
          <div class="ledger-reference">
            <h2>Dispense history</h2>
            <p>
              {{ appliedPatient }}
              @if (appliedMedicine) {
                · {{ appliedMedicine }}
              }
            </p>
          </div>
          <span>Newest first · Johannesburg time</span>
        </div>
      }
      @if (loading) {
        <p class="loading" role="status">Loading dispenses…</p>
      }
      @if (error) {
        <div class="notice danger inline-notice" role="alert">
          <p>{{ error }}</p>
          <button type="button" class="secondary" (click)="retry()">
            Retry loading
          </button>
        </div>
      }
      @if (!searched) {
        <div class="empty">
          <span class="empty-symbol" aria-hidden="true">≡</span>
          <h2>A clear view of each dispense</h2>
          <p>
            Enter a patient reference above to open their ledger. Add a medicine
            code to narrow the results.
          </p>
        </div>
      }
      @if (searched && !loading && !error && !rows.length) {
        <div class="empty">
          <span class="empty-symbol" aria-hidden="true">≡</span>
          <h2>No dispenses found</h2>
          <p>
            Check the patient reference and any medicine filter. Only
            successfully recorded dispenses appear here.
          </p>
        </div>
      }
      @if (rows.length) {
        <div
          class="table-wrap"
          tabindex="0"
          role="region"
          aria-label="Dispenses, scroll horizontally on smaller screens"
          [attr.aria-busy]="loading"
        >
          <table class="ledger-table">
            <caption class="sr-only">
              Dispenses on page
              {{
                history.length + 1
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">Dispensed at</th>
                <th scope="col">Medicine</th>
                <th scope="col">Quantity</th>
                <th scope="col">Record</th>
              </tr>
            </thead>
            <tbody>
              @for (d of rows; track d.id) {
                <tr>
                  <td class="nowrap">{{ d.dispensed_at | localDate }}</td>
                  <td>
                    <a [routerLink]="['/medicines', d.medicine_code]">{{
                      d.medicine_code
                    }}</a>
                  </td>
                  <td>
                    <strong>{{ d.quantity }}</strong>
                  </td>
                  <td class="muted">#{{ d.id }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      @if (searched) {
        <div class="pager">
          <p role="status">
            Page {{ history.length + 1 }} · {{ rows.length }}
            {{ rows.length === 1 ? "record" : "records" }} shown
          </p>
          <div class="actions">
            <button
              class="secondary"
              (click)="previous()"
              [disabled]="loading || !history.length"
            >
              Previous</button
            ><button
              class="secondary"
              (click)="advance()"
              [disabled]="loading || !next"
            >
              Next
            </button>
          </div>
        </div>
      }
    </section>
    <p class="page-note">
      Use the patient reference exactly as recorded. Do not enter a patient's
      name or other personal details.
    </p>`,
})
export class Ledger {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private destroy = inject(DestroyRef);
  private request?: Subscription;
  private failedCursor: string | null = null;
  private failedHistory: (string | null)[] = [];
  patient = this.route.snapshot.queryParamMap.get("patient") ?? "";
  medicine = "";
  appliedPatient = "";
  appliedMedicine = "";
  rows: Dispense[] = [];
  history: (string | null)[] = [];
  current: string | null = null;
  next: string | null = null;
  loading = false;
  error = "";
  searched = false;
  constructor() {
    if (this.patient) this.search();
  }
  search() {
    if (!this.patient.trim()) return;
    this.appliedPatient = this.patient;
    this.appliedMedicine = this.medicine;
    this.history = [];
    this.rows = [];
    this.next = null;
    this.current = null;
    this.searched = true;
    this.load(null);
  }
  advance() {
    if (this.next) this.load(this.next, [...this.history, this.current]);
  }
  previous() {
    if (this.history.length)
      this.load(this.history.at(-1) ?? null, this.history.slice(0, -1));
  }
  retry() {
    this.load(this.failedCursor, this.failedHistory);
  }
  load(cursor: string | null, history = this.history) {
    this.request?.unsubscribe();
    this.loading = true;
    this.error = "";
    this.failedCursor = cursor;
    this.failedHistory = history;
    this.request = this.api
      .get<Page<Dispense>>("/dispenses", {
        patient_ref: this.appliedPatient,
        medicine: this.appliedMedicine || null,
        cursor,
      })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (p) => {
          this.current = cursor;
          this.history = history;
          this.rows = p.data;
          this.next = p.next_cursor;
          this.loading = false;
        },
        error: (e) => {
          this.error = violations(e)
            .map((v) => v.message)
            .join(" ");
          this.loading = false;
        },
      });
  }
}

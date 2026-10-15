import { Component, DestroyRef, ElementRef, inject } from "@angular/core";
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  AbstractControl,
} from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { Api, Dispense, Violation, violations } from "./api";
import { johannesburgNow, johannesburgToUtc } from "./time";
import { LocalDate } from "./local-date";

type CaptureValues = {
  medicine_code: string;
  patient_ref: string;
  quantity: number;
  dispensed_at: string;
  authorisation_ref: string;
};
type Submission = {
  version: 1;
  key: string;
  values: CaptureValues;
  timestamp: string;
};
const STORAGE_KEY = "pharmacy.pending-dispense.v1";
const fields = new Map([
  ["medicine_code", { id: "medicine", label: "Medicine code" }],
  ["patient_ref", { id: "patient", label: "Patient reference" }],
  ["quantity", { id: "quantity", label: "Quantity" }],
  ["dispensed_at", { id: "at", label: "Dispensed at" }],
  ["authorisation_ref", { id: "auth", label: "Authorisation reference" }],
]);
function validSubmission(value: unknown): value is Submission {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<Submission>;
  if (
    p.version !== 1 ||
    typeof p.key !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(p.key) ||
    !p.values
  )
    return false;
  const v = p.values;
  if (
    ![
      v.medicine_code,
      v.patient_ref,
      v.dispensed_at,
      v.authorisation_ref,
    ].every((x) => typeof x === "string")
  )
    return false;
  if (
    !v.medicine_code.trim() ||
    v.medicine_code.length > 64 ||
    !v.patient_ref.trim() ||
    v.patient_ref.length > 128 ||
    v.authorisation_ref.length > 200 ||
    !Number.isInteger(v.quantity) ||
    v.quantity <= 0 ||
    v.quantity > 2147483647
  )
    return false;
  try {
    return johannesburgToUtc(v.dispensed_at) === p.timestamp;
  } catch {
    return false;
  }
}
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, LocalDate],
  template: ` <div class="page-heading">
      <div>
        <p class="eyebrow">Dispensing</p>
        <h1>Capture dispense</h1>
        <p class="subtitle">
          Record a dispense against the patient's applicable formulary rules.
        </p>
      </div>
    </div>
    @if (pending && !busy) {
      <div class="notice warning" role="status">
        <strong>Confirmation is still pending.</strong>
        <p>
          Your details are saved in this tab. Retry the pending dispense before
          starting another one.
        </p>
      </div>
    }
    @if (errors.length) {
      <div class="notice danger" role="alert" tabindex="-1" data-feedback>
        <h2>Dispense not confirmed</h2>
        <ul>
          @for (e of errors; track $index) {
            <li>
              @if (fieldId(e.field); as id) {
                <a [href]="'#' + id" (click)="focusField($event, id)"
                  >{{ fieldName(e.field) }}: {{ e.message }}</a
                >
              } @else {
                Request: {{ e.message }}
              }
            </li>
          }
        </ul>
      </div>
    }
    @if (success; as d) {
      <section
        class="card receipt"
        role="status"
        tabindex="-1"
        data-feedback
        aria-label="Recorded dispense"
      >
        <p class="eyebrow">Successfully recorded</p>
        <h2>Dispense #{{ d.id }} recorded.</h2>
        <dl>
          <div>
            <dt>Patient reference</dt>
            <dd>{{ d.patient_ref }}</dd>
          </div>
          <div>
            <dt>Medicine / quantity</dt>
            <dd>{{ d.medicine_code }} · {{ d.quantity }} units</dd>
          </div>
          <div>
            <dt>Dispensed at · Johannesburg</dt>
            <dd>{{ d.dispensed_at | localDate }}</dd>
          </div>
        </dl>
        <div class="actions">
          <a
            class="button"
            routerLink="/ledger"
            [queryParams]="{ patient: d.patient_ref }"
            >View patient ledger</a
          ><button class="secondary" (click)="newAttempt()">
            New dispense
          </button>
        </div>
      </section>
    }
    <div class="capture-grid">
      <form
        class="card capture-form"
        [formGroup]="form"
        (ngSubmit)="submit()"
        autocomplete="off"
      >
        <div class="card-title">
          <div>
            <h2>{{ success ? "Recorded details" : "Dispense details" }}</h2>
            <p>All fields required unless marked otherwise</p>
          </div>
        </div>
        <fieldset [disabled]="busy || !!pending || !!success || storageBlocked">
          <legend class="sr-only">Dispense details</legend>
          <div class="field">
            <label for="medicine">Medicine code</label
            ><input
              id="medicine"
              formControlName="medicine_code"
              required
              maxlength="64"
              placeholder="e.g. MED0001"
              aria-describedby="medicine-hint medicine-errors"
              [attr.aria-invalid]="invalid('medicine_code')"
            />
            <p class="hint" id="medicine-hint">
              Use the exact code from the
              <a routerLink="/medicines" target="_blank" rel="noopener"
                >medicine catalogue (new tab)</a
              >.
            </p>
            <div id="medicine-errors">
              @if (clientError("medicine_code")) {
                <p class="field-error">{{ clientError("medicine_code") }}</p>
              }
              @for (e of forField("medicine_code"); track $index) {
                <p class="error">{{ e.message }}</p>
              }
            </div>
          </div>
          <div class="field">
            <label for="patient">Patient reference</label
            ><input
              id="patient"
              formControlName="patient_ref"
              required
              maxlength="128"
              placeholder="e.g. SYNTHETIC-00000"
              aria-describedby="patient-hint patient-errors"
              [attr.aria-invalid]="invalid('patient_ref')"
            />
            <p class="hint" id="patient-hint">
              An opaque reference only. Do not enter a patient's name.
            </p>
            <div id="patient-errors">
              @if (clientError("patient_ref")) {
                <p class="field-error">{{ clientError("patient_ref") }}</p>
              }
              @for (e of forField("patient_ref"); track $index) {
                <p class="error">{{ e.message }}</p>
              }
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label for="quantity">Quantity</label
              ><input
                id="quantity"
                type="number"
                formControlName="quantity"
                min="1"
                max="2147483647"
                step="1"
                required
                aria-describedby="quantity-hint quantity-errors"
                [attr.aria-invalid]="invalid('quantity')"
              />
              <p class="hint" id="quantity-hint">Whole units</p>
              <div id="quantity-errors">
                @if (clientError("quantity")) {
                  <p class="field-error">{{ clientError("quantity") }}</p>
                }
                @for (e of forField("quantity"); track $index) {
                  <p class="error">{{ e.message }}</p>
                }
              </div>
            </div>
            <div class="field">
              <label for="at">Dispensed at</label
              ><input
                id="at"
                type="datetime-local"
                step="1"
                formControlName="dispensed_at"
                required
                aria-describedby="at-hint at-errors"
                [attr.aria-invalid]="invalid('dispensed_at')"
              />
              <p class="hint" id="at-hint">
                Johannesburg time. Backdated entries are supported.
              </p>
              <div id="at-errors">
                @if (clientError("dispensed_at")) {
                  <p class="field-error">{{ clientError("dispensed_at") }}</p>
                }
                @for (e of forField("dispensed_at"); track $index) {
                  <p class="error">{{ e.message }}</p>
                }
              </div>
            </div>
          </div>
          <div class="field">
            <label for="auth"
              >Authorisation reference
              <span class="optional">(if required)</span></label
            ><input
              id="auth"
              formControlName="authorisation_ref"
              maxlength="200"
              placeholder="Enter the authorisation reference"
              aria-describedby="auth-hint auth-errors"
              [attr.aria-invalid]="invalid('authorisation_ref')"
            />
            <p class="hint" id="auth-hint">
              Required only when the rule at the dispense time requests it.
            </p>
            <div id="auth-errors">
              @for (e of forField("authorisation_ref"); track $index) {
                <p class="error">{{ e.message }}</p>
              }
            </div>
          </div>
        </fieldset>
        <div class="form-actions">
          <p class="hint">
            {{
              success
                ? "Start a new dispense to enter another record."
                : "Medicine status and all applicable limits are checked on submission."
            }}
          </p>
          <button
            type="submit"
            [disabled]="form.invalid || busy || !!success || storageBlocked"
          >
            {{
              busy
                ? "Submitting…"
                : pending
                  ? "Retry pending dispense"
                  : "Submit dispense"
            }}
          </button>
        </div>
      </form>
      <aside>
        <section class="card aside-card">
          <p class="eyebrow">Before you submit</p>
          <h2>A quick check</h2>
          <div class="step">
            <span class="step-number">1</span>
            <div>
              <strong>Confirm the medicine</strong>
              <p>
                Check its status and the rule that applies to your dispense
                date.
              </p>
              @if (form.controls.medicine_code.value.trim()) {
                <a
                  class="rule-link"
                  target="_blank"
                  rel="noopener"
                  [routerLink]="[
                    '/medicines',
                    form.controls.medicine_code.value,
                  ]"
                  >View rules for {{ form.controls.medicine_code.value }} →<span
                    class="sr-only"
                  >
                    (opens in a new tab)</span
                  ></a
                >
              }
            </div>
          </div>
          <div class="step">
            <span class="step-number">2</span>
            <div>
              <strong>Use the correct reference</strong>
              <p>
                Keep the patient's reference consistent with their existing
                ledger.
              </p>
            </div>
          </div>
          <div class="step">
            <span class="step-number">3</span>
            <div>
              <strong>Check quantity and time</strong>
              <p>
                The 30-day limit includes earlier dispenses for this patient and
                medicine.
              </p>
            </div>
          </div>
        </section>
        <p class="aside-note">
          Keep this tab open until the result is confirmed. If the connection is
          interrupted, you can safely retry the saved dispense.
        </p>
      </aside>
    </div>`,
})
export class Capture {
  private api = inject(Api);
  private element: ElementRef<HTMLElement> = inject(ElementRef);
  private fb = inject(FormBuilder);
  private destroy = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  key = crypto.randomUUID();
  busy = false;
  storageBlocked = false;
  errors: Violation[] = [];
  success?: Dispense;
  pending?: Submission;
  form = this.fb.nonNullable.group({
    medicine_code: [
      this.route.snapshot.queryParamMap.get("medicine") ?? "",
      [Validators.required, Validators.maxLength(64), Validators.pattern(/\S/)],
    ],
    patient_ref: [
      "",
      [
        Validators.required,
        Validators.maxLength(128),
        Validators.pattern(/\S/),
      ],
    ],
    quantity: [
      1,
      [
        Validators.required,
        Validators.min(1),
        Validators.max(2147483647),
        (control: AbstractControl) =>
          Number.isInteger(control.value) ? null : { integer: true },
      ],
    ],
    dispensed_at: [
      johannesburgNow(),
      [
        Validators.required,
        (control: AbstractControl) => {
          try {
            johannesburgToUtc(control.value);
            return null;
          } catch (e) {
            return {
              localTime:
                e instanceof Error
                  ? e.message
                  : "Enter a valid local date and time.",
            };
          }
        },
      ],
    ],
    authorisation_ref: ["", Validators.maxLength(200)],
  });
  constructor() {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (!validSubmission(parsed))
          throw new Error("Invalid pending request");
        this.pending = parsed;
        this.key = parsed.key as typeof this.key;
        this.form.setValue(parsed.values);
      }
    } catch {
      this.storageBlocked = true;
      this.errors = [
        {
          code: "pending_storage",
          field: "",
          message:
            "Pending request storage cannot be read. Check the ledger and browser tab storage before submitting again.",
        },
      ];
    }
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe(() => {
        if (!this.pending && !this.busy && !this.success) {
          this.key = crypto.randomUUID();
          this.errors = [];
        }
      });
  }
  newAttempt() {
    if (this.pending || this.busy || this.storageBlocked) return;
    this.success = undefined;
    this.errors = [];
    this.key = crypto.randomUUID();
    this.form.reset({
      medicine_code: this.form.getRawValue().medicine_code,
      patient_ref: "",
      quantity: 1,
      dispensed_at: johannesburgNow(),
      authorisation_ref: "",
    });
    setTimeout(
      () =>
        this.element.nativeElement
          .querySelector<HTMLElement>("#patient")
          ?.focus(),
      0,
    );
  }
  forField(field: string) {
    return this.errors.filter((e) => e.field === field);
  }
  focusField(event: Event, id: string) {
    event.preventDefault();
    this.element.nativeElement.querySelector<HTMLElement>("#" + id)?.focus();
  }
  fieldId(field: string): string {
    return fields.get(field)?.id ?? "";
  }
  fieldName(field: string): string {
    return fields.get(field)?.label ?? "Request";
  }
  invalid(field: keyof CaptureValues): boolean {
    const c = this.form.controls[field];
    return (c.touched && c.invalid) || this.forField(field).length > 0;
  }
  clientError(field: keyof CaptureValues): string {
    const c = this.form.controls[field];
    if (!c.touched || !c.invalid) return "";
    if (field === "quantity")
      return "Enter a whole number between 1 and 2,147,483,647.";
    if (field === "dispensed_at")
      return c.errors?.["localTime"] ?? "Enter a date and time.";
    return "Enter a non-blank " + this.fieldName(field).toLowerCase() + ".";
  }
  private focusFeedback() {
    setTimeout(
      () =>
        this.element.nativeElement
          .querySelector<HTMLElement>("[data-feedback]")
          ?.focus(),
      0,
    );
  }
  submit() {
    if (this.form.invalid || this.busy || this.success || this.storageBlocked)
      return;
    const values = this.form.getRawValue();
    if (!this.pending) {
      let timestamp: string;
      try {
        timestamp = johannesburgToUtc(values.dispensed_at);
      } catch (e) {
        this.errors = [
          {
            code: "invalid_local_time",
            field: "dispensed_at",
            message:
              e instanceof Error ? e.message : "Enter a valid local time.",
          },
        ];
        return;
      }
      const candidate: Submission = {
        version: 1,
        key: this.key,
        values,
        timestamp,
      };
      try {
        // Persist BEFORE sending. If storage fails, no request is made.
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
        this.pending = candidate;
      } catch {
        this.errors = [
          {
            code: "storage_unavailable",
            field: "",
            message:
              "Browser tab storage is unavailable. Enable it before submitting so retries remain safe.",
          },
        ];
        this.focusFeedback();
        return;
      }
    }
    const pending = this.pending;
    this.busy = true;
    this.errors = [];
    this.api
      .post<{ data: Dispense }>("/dispenses", {
        ...pending.values,
        dispensed_at: pending.timestamp,
        authorisation_ref: pending.values.authorisation_ref || null,
        idempotency_key: pending.key,
      })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (p) => {
          this.success = p.data;
          this.busy = false;
          this.clearPending();
          this.focusFeedback();
        },
        error: (e) => {
          this.errors = violations(e);
          this.busy = false;
          // A 5xx, transport error, or throttling may arrive after a lost successful
          // response on an earlier try. Preserve the exact payload until resolved.
          if ([409, 422].includes(e.status)) this.clearPending();
          this.focusFeedback();
          this.focusFeedback();
        },
      });
  }
  private clearPending() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      this.pending = undefined;
    } catch {
      this.storageBlocked = true;
    }
  }
}

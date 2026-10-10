import { FormEvent, useMemo, useState } from "react";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LogIn,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VeloRayMark } from "@/components/brand/veloray-mark";
import { login } from "@/lib/api";
import { useTheme } from "@/components/theme/theme-provider";

type Locale = "en" | "fa";

const copy = {
  en: {
    title: "Login to your account",
    subtitle: "Enter your username and password.",
    username: "Username",
    password: "Password",
    code: "Authenticator / recovery code",
    signIn: "Login",
    verify: "Verify and continue",
    back: "Back to login",
    loading: "Please wait…",
    secure: "Secure administrator access",
    version: "VeloRay v0.1.0",
    usernamePlaceholder: "Username",
    passwordPlaceholder: "Password",
    codePlaceholder: "000000",
    verifyTitle: "Verify your identity",
    verifySubtitle:
      "Enter the code from your authenticator app or use a recovery code.",
  },
  fa: {
    title: "ورود به حساب کاربری",
    subtitle: "نام کاربری و رمز عبورت را وارد کن.",
    username: "نام کاربری",
    password: "رمز عبور",
    code: "کد احراز هویت / بازیابی",
    signIn: "ورود",
    verify: "تأیید و ادامه",
    back: "بازگشت به ورود",
    loading: "لطفاً صبر کنید…",
    secure: "دسترسی امن مدیر سیستم",
    version: "VeloRay v0.1.0",
    usernamePlaceholder: "نام کاربری",
    passwordPlaceholder: "رمز عبور",
    codePlaceholder: "000000",
    verifyTitle: "تأیید هویت",
    verifySubtitle:
      "کد برنامه احراز هویت یا یکی از کدهای بازیابی را وارد کنید.",
  },
} as const;

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [need2fa, setNeed2fa] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [locale, setLocale] = useState<Locale>(() =>
    localStorage.getItem("veloray-login-locale") === "fa" ? "fa" : "en",
  );
  const { resolved, setTheme } = useTheme();

  const t = copy[locale];
  const rtl = locale === "fa";
  const formTitle = need2fa ? t.verifyTitle : t.title;
  const formSubtitle = need2fa ? t.verifySubtitle : t.subtitle;

  const canSubmit = useMemo(() => {
    if (busy) return false;
    return need2fa
      ? Boolean(code.trim())
      : Boolean(username.trim() && password);
  }, [busy, need2fa, code, username, password]);

  function toggleLocale() {
    const next: Locale = locale === "en" ? "fa" : "en";
    localStorage.setItem("veloray-login-locale", next);
    setLocale(next);
    setError("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setBusy(true);
    try {
      const result: any = await login(username.trim(), password, code.trim());
      if (result.two_factor_required) {
        setNeed2fa(true);
        setCode("");
        return;
      }
      onSuccess();
    } catch (err: any) {
      setError(err?.message || "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }

  function backToPassword() {
    setNeed2fa(false);
    setCode("");
    setError("");
  }

  return (
    <main
      className="min-h-screen bg-[var(--bg)] text-[var(--fg)]"
      lang={locale}
      dir={rtl ? "rtl" : "ltr"}
    >
      <div className="flex min-h-screen w-full flex-col justify-between p-5 sm:p-6">
        <header className="flex w-full items-center justify-between">
          <button
            type="button"
            onClick={toggleLocale}
            className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 text-[11px] font-medium text-[var(--muted-strong)] shadow-sm transition hover:bg-[var(--surface-2)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            aria-label="Change login language"
          >
            {locale === "en" ? "FA" : "EN"}
          </button>

          <button
            type="button"
            onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
            className="grid h-9 w-9 place-items-center rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--muted-strong)] shadow-sm transition hover:bg-[var(--surface-2)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            aria-label="Toggle theme"
          >
            {resolved === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </header>

        <section className="flex w-full flex-1 items-center justify-center py-8 sm:py-12">
          <div className="w-full max-w-[340px]">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="mb-1 grid h-20 w-20 place-items-center drop-shadow-[0_14px_28px_rgba(0,237,123,.12)]">
                <VeloRayMark className="h-20 w-20" />
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-.025em] text-[var(--fg)]">
                {formTitle}
              </h1>
              <p className="max-w-[310px] text-[13px] leading-5 text-[var(--muted)]">
                {formSubtitle}
              </p>
            </div>

            <div className="mx-auto w-full max-w-[300px] pt-4">
              <form
                onSubmit={submit}
                autoComplete="on"
                className="mt-4 space-y-3"
              >
                {!need2fa ? (
                  <>
                    <label className="block">
                      <span className="sr-only">{t.username}</span>
                      <input
                        autoFocus
                        autoComplete="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="input h-11 bg-[var(--card)] text-[13px]"
                        placeholder={t.usernamePlaceholder}
                        aria-label={t.username}
                      />
                    </label>

                    <label className="relative block">
                      <span className="sr-only">{t.password}</span>
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`input h-11 bg-[var(--card)] text-[13px] ${rtl ? "pl-11" : "pr-11"}`}
                        placeholder={t.passwordPlaceholder}
                        aria-label={t.password}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className={`absolute inset-y-0 grid w-11 place-items-center text-[var(--muted)] transition hover:text-[var(--fg)] ${rtl ? "left-0" : "right-0"}`}
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </label>
                  </>
                ) : (
                  <label className="relative block">
                    <span className="sr-only">{t.code}</span>
                    <KeyRound
                      className={`pointer-events-none absolute top-3.5 h-4 w-4 text-[var(--muted)] ${rtl ? "right-3.5" : "left-3.5"}`}
                    />
                    <input
                      autoFocus
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className={`input h-11 bg-[var(--card)] text-[13px] tracking-[.16em] ${rtl ? "pr-10" : "pl-10"}`}
                      placeholder={t.codePlaceholder}
                      aria-label={t.code}
                    />
                  </label>
                )}

                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2.5 text-[12px] leading-5 text-red-500"
                  >
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  className="h-11 w-full border-[var(--brand)] bg-[var(--brand)] text-[13px] text-black hover:bg-[var(--brand-strong)] hover:opacity-100"
                  disabled={!canSubmit}
                >
                  {busy ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      {t.loading}
                    </>
                  ) : (
                    <>
                      <LogIn className="h-4 w-4" />
                      {need2fa ? t.verify : t.signIn}
                    </>
                  )}
                </Button>

                {need2fa && (
                  <button
                    type="button"
                    onClick={backToPassword}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-md text-[11px] font-medium text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                  >
                    <ArrowLeft
                      className={`h-3.5 w-3.5 ${rtl ? "rotate-180" : ""}`}
                    />
                    {t.back}
                  </button>
                )}
              </form>
            </div>
          </div>
        </section>

        <footer className="flex flex-col items-center gap-1.5 pb-1 text-center">
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{t.secure}</span>
          </div>
          <div className="text-[9px] font-medium uppercase tracking-[.12em] text-[var(--muted)] opacity-80">
            {t.version}
          </div>
        </footer>
      </div>
    </main>
  );
}

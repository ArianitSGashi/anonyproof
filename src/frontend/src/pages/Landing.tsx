import { Link } from "react-router";
import {
  Shield,
  Eye,
  Fingerprint,
  MessageSquare,
  Users,
  Lock,
  ArrowRight,
} from "lucide-react";
import logo from "../assets/up-logo.webp";
import { Button } from "../components/ui";

const features = [
  {
    icon: Fingerprint,
    title: "Zero-Knowledge Proofs",
    description:
      "Prove you belong to a university group without revealing who you are. Powered by Semaphore Protocol v4.",
  },
  {
    icon: Eye,
    title: "Blind Signatures",
    description:
      "RSA blind signatures ensure the admin who verifies your student status cannot link it to your anonymous identity.",
  },
  {
    icon: Shield,
    title: "AI Moderation",
    description:
      "Content is automatically screened for toxicity while preserving author anonymity. No tracking, no profiling.",
  },
  {
    icon: Lock,
    title: "Nullifier-Based Privacy",
    description:
      "Double-action prevention via cryptographic nullifiers — no user accounts, no cookies, no fingerprinting.",
  },
  {
    icon: MessageSquare,
    title: "Anonymous Discussion",
    description:
      "Post, comment, and vote anonymously within your university community. Your identity stays yours alone.",
  },
  {
    icon: Users,
    title: "Group Isolation",
    description:
      "Each university is a separate Semaphore group. Activity in one group cannot be correlated with another.",
  },
];

const steps = [
  {
    step: "01",
    title: "Generate Identity",
    description: "Create a Semaphore identity locally in your browser. Your private keys never leave your device.",
  },
  {
    step: "02",
    title: "Request Credential",
    description: "Submit your university email with a blinded commitment. The admin verifies you are a student but cannot see your identity.",
  },
  {
    step: "03",
    title: "Join & Participate",
    description: "Unblind the signature, register your commitment, and start posting, commenting, and voting — fully anonymous.",
  },
];

export function Landing() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-950 via-primary-900 to-slate-900" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--color-primary-700)_0%,_transparent_60%)] opacity-40" />

        {/* Header (in hero) */}
        <header className="relative z-10">
          <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <img
                src={logo}
                alt="University of Prishtina"
                className="h-10 w-10 rounded-full bg-white/10 p-0.5"
              />
              <span className="text-xl font-bold text-white">
                Anony<span className="text-primary-300">Proof</span>
              </span>
            </div>
            <nav className="flex items-center gap-4">
              <Link
                to="/feed"
                className="text-sm font-medium text-primary-200 hover:text-white"
              >
                Feed
              </Link>
              <Link
                to="/identity"
                className="text-sm font-medium text-primary-200 hover:text-white"
              >
                Setup Identity
              </Link>
              <Link to="/admin/login">
                <Button variant="secondary" size="sm">
                  Admin Login
                </Button>
              </Link>
            </nav>
          </div>
        </header>

        {/* Hero content */}
        <div className="relative z-10 mx-auto max-w-6xl px-4 pb-32 pt-20 sm:px-6 lg:pt-28">
          <div className="flex flex-col items-center text-center">
            <img
              src={logo}
              alt="University of Prishtina"
              className="mb-8 h-28 w-28 rounded-full bg-white/10 p-2 ring-2 ring-white/20 backdrop-blur-sm"
            />
            <div className="inline-flex items-center gap-2 rounded-full border border-primary-400/30 bg-primary-500/10 px-4 py-1.5 text-sm text-primary-200 mb-6 backdrop-blur-sm">
              <Shield className="h-3.5 w-3.5" />
              University of Prishtina
            </div>
            <h1 className="max-w-3xl text-5xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
              Speak freely.{" "}
              <span className="bg-gradient-to-r from-primary-300 to-primary-400 bg-clip-text text-transparent">
                Stay anonymous.
              </span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-primary-200/80 leading-relaxed">
              AnonyProof is a zero-knowledge anonymous discussion platform for
              university communities. Prove your membership without revealing
              your identity — backed by cryptographic guarantees, not promises.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link to="/identity">
                <Button size="lg">
                  Get Started
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <Link to="/feed">
                <Button variant="ghost" size="lg" className="!text-primary-200 hover:!bg-white/10">
                  Browse Feed
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-b border-slate-100 bg-slate-50 py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900">
              How it works
            </h2>
            <p className="mt-3 text-slate-500">
              Three simple steps to anonymous participation
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {steps.map(({ step, title, description }) => (
              <div
                key={step}
                className="relative rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
              >
                <span className="text-5xl font-black text-primary-100">
                  {step}
                </span>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900">
              Privacy by design
            </h2>
            <p className="mt-3 text-slate-500">
              Every layer of the stack is built to protect your identity
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-primary-200 hover:shadow-md"
              >
                <div className="mb-4 inline-flex rounded-xl bg-primary-50 p-3 text-primary-600 group-hover:bg-primary-100">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-100 bg-slate-50 py-24">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <img
            src={logo}
            alt="University of Prishtina"
            className="mx-auto mb-6 h-16 w-16"
          />
          <h2 className="text-3xl font-bold text-slate-900">
            Ready to join the conversation?
          </h2>
          <p className="mt-3 text-slate-500">
            Set up your anonymous identity in seconds. No account required.
          </p>
          <div className="mt-8">
            <Link to="/identity">
              <Button size="lg">
                Create Your Identity
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 text-sm text-slate-400">
          <div className="flex items-center gap-2">
            <img src={logo} alt="" className="h-5 w-5" />
            <span>AnonyProof</span>
          </div>
          <p>University of Prishtina &middot; Graduation Project</p>
        </div>
      </footer>
    </div>
  );
}

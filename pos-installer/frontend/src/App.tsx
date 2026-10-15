import { useCallback, useEffect, useState } from "react";
import { SetupService } from "../bindings/pos-installer";
import Wizard from "./wizard/Wizard";
import PosApp from "./pos/PosApp";
import { ToastHost } from "./lib/toast";
import { errorMessage } from "./lib/format";

type Phase = "loading" | "wizard" | "app" | "error";

function LoadingScreen({ text }: { text: string }) {
  return (
    <div className="loading-screen">
      <img src="/logo.svg" alt="" className="ls-logo" />
      <div className="ls-text">{text}</div>
      <div className="spinner dark" />
    </div>
  );
}

function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [bootError, setBootError] = useState("");

  const check = useCallback(async () => {
    try {
      const configured = await SetupService.IsConfigured();
      setBootError("");
      setPhase(configured ? "app" : "wizard");
    } catch (err) {
      setBootError(errorMessage(err));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (phase === "loading") return <LoadingScreen text="Starting Offline POS…" />;
  if (phase === "error") {
    return (
      <div className="loading-screen">
        <img src="/logo.svg" alt="" className="ls-logo" />
        <div className="ls-text">Something went wrong while starting the app.</div>
        <div className="empty-sub subtle" style={{ maxWidth: 420, textAlign: "center" }}>
          {bootError}
        </div>
        <button className="btn btn-primary" onClick={check}>
          Try again
        </button>
        <ToastHost />
      </div>
    );
  }

  return (
    <>
      {phase === "wizard" ? <Wizard onDone={check} /> : <PosApp onWizardReset={check} />}
      <ToastHost />
    </>
  );
}

export default App;

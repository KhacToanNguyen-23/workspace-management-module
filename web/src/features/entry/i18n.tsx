import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { translate, type Lang, type Vars } from "../../shared/lib/translate";

export type { Lang } from "../../shared/lib/translate";

const KEY = "hyperspace-lang";

const dict = {
  vi: {
    signIn: "Đăng nhập",
    enter: "Vào HyperSpace",
    discover: "Tìm hiểu HyperSpace",
    eyebrow: "Không gian làm việc học thuật cộng tác",
    headline1: "Cùng nhau nghiên cứu.",
    headline2: "Nghĩ xa hơn mọi giới hạn.",
    description:
      "Gom nghiên cứu, tài liệu và cộng sự của bạn vào một không gian làm việc có tổ chức.",
    capabilitiesTitle: "Những gì HyperSpace hỗ trợ",
    cap1Title: "Workspace nghiên cứu",
    cap1Body:
      "Tạo không gian riêng, có tổ chức cho từng dự án và hoạt động nghiên cứu.",
    cap2Title: "Cộng tác nhóm",
    cap2Body:
      "Quản lý thành viên, vai trò và luồng duyệt tham gia trong từng workspace.",
    cap3Title: "Tổ chức tri thức",
    cap3Body:
      "Theo dõi các yêu cầu paper và tài liệu học thuật của nhóm ở một nơi.",
    footer: "Không gian tập trung cho nghiên cứu và cộng tác.",
    langLabel: "Ngôn ngữ",
    // Login
    loginTitle: "Đăng nhập HyperSpace",
    loginBody: (domain: string) =>
      `Đăng nhập một lần (SSO) bằng tài khoản Google @${domain}. Tài khoản được đối chiếu với danh sách member của lab; sau khi vào, chọn workspace và chờ manager duyệt.`,
    loginGoogle: "Đăng nhập với Google",
    loginSso: "Đăng nhập bằng tài khoản HyperDataLab",
    loginDevEmail: (domain: string) =>
      `Hoặc nhập email @${domain} bất kỳ (tạo member mới)`,
    loginDevSubmit: "Đăng nhập (dev)",
    backHome: "Về trang giới thiệu",
  },
  en: {
    signIn: "Sign in",
    enter: "Enter HyperSpace",
    discover: "Discover HyperSpace",
    eyebrow: "Collaborative academic workspace",
    headline1: "Research together.",
    headline2: "Think beyond boundaries.",
    description:
      "Bring your research, documents, and collaborators into one organized workspace.",
    capabilitiesTitle: "What HyperSpace supports",
    cap1Title: "Research Workspaces",
    cap1Body:
      "Create organized spaces for academic projects and research activities.",
    cap2Title: "Team Collaboration",
    cap2Body:
      "Manage workspace members, roles, and shared research workflows.",
    cap3Title: "Knowledge Organization",
    cap3Body:
      "Keep your team's paper requests and academic resources in one place.",
    footer: "A focused space for research and collaboration.",
    langLabel: "Language",
    loginTitle: "Sign in to HyperSpace",
    loginBody: (domain: string) =>
      `Single sign-on with your @${domain} Google account. Your account is checked against the lab's member list; once inside, pick a workspace and wait for a manager to approve you.`,
    loginGoogle: "Sign in with Google",
    loginSso: "Sign in with your HyperDataLab account",
    loginDevEmail: (domain: string) =>
      `Or enter any @${domain} email (creates a new member)`,
    loginDevSubmit: "Sign in (dev)",
    backHome: "Back to the overview",
  },
} satisfies Record<Lang, Record<string, unknown>>;

export type Copy = (typeof dict)["vi"];

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "vi" || saved === "en") return saved;
  } catch {
    /* storage blocked: fall back to the browser language */
  }
  return navigator.language?.toLowerCase().startsWith("vi") ? "vi" : "en";
}

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangState | null>(null);

/** One language for the whole app, remembered per browser and mirrored on <html lang>. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* not persisted; the choice still applies until reload */
    }
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/** Language state plus the entry/login copy. */
export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang needs a LangProvider");
  return { lang: ctx.lang, setLang: ctx.setLang, t: dict[ctx.lang] as Copy };
}

/** Translator for in-app strings: tr("Vietnamese text", { placeholder: value }). */
export function useTr() {
  const { lang } = useLang();
  return useCallback((vi: string, vars?: Vars) => translate(lang, vi, vars), [lang]);
}

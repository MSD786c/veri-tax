import { RULE_TEXT } from "@/lib/rules";

/** Small "i" next to a rule ID: hover, focus or screen reader gives the rule's plain-language meaning. */
export function RuleInfo({ id }: { id: string }) {
  const text = RULE_TEXT[id];
  if (!text) return null;
  return (
    <span className="rule-info" tabIndex={0} role="note" aria-label={`${id}: ${text}`} data-tip={text}>
      i
    </span>
  );
}

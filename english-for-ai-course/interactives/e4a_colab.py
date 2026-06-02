"""E4A Colab helper module.

Every Colab lab notebook loads this module from the configured public GitHub
raw URL inside a **protected Step 1 bootstrap cell** (`# @title Step 1: Start
the lab`). The cell looks like::

    import urllib.request
    HELPER_URL = "https://raw.githubusercontent.com/<gh-user>/<gh-repo>/<gh-branch>/english-for-ai-course/interactives/e4a_colab.py"
    try:
        exec(urllib.request.urlopen(HELPER_URL, timeout=10).read().decode("utf-8"))
    except Exception:
        # ... define tiny inline fallback stubs for show, show_ai_answer,
        # show_portfolio_markdown, show_ai_check_block, verify_quote_in_source,
        # safe_ai_response, ai_review_*, and start_e4a_lab, then display:
        # "The lab helper could not load. This may be a network problem.
        #  Ask your teacher, or use the regular worksheet steps.
        #  You did not break anything."
    start_e4a_lab("class-XX")

The `exec` evaluates this file's top-level definitions in the notebook's
namespace, so students never see helper code. They only call short, named
functions: ``ai_review_prompt(...)``, ``show_ai_answer(...)``,
``show_portfolio_markdown(...)``, ``verify_quote_in_source(...)``, and so on.

If the URL is unreachable (no network, GitHub outage, wrong fork), the
`except` branch in the Step 1 cell defines compact fallback stubs with the
same names. Later cells continue to run without ``NameError``, the AI
review helpers return the friendly fallback message, and the student can
still finish the deterministic portfolio task. The full helper reloads
the next time Step 1 succeeds.

Safety contract (kept identical across every lab):

* Colab AI is used **automatically** when available. There is **no manual
  USE_COLAB_AI switch**, no API key, no environment variable.
* If Colab AI is unavailable, a friendly fallback message is returned and
  the rest of the lab still works with the regular deterministic steps.
* No external AI SDKs (OpenAI, Anthropic, google-generativeai, LangChain),
  no ``pip install`` at run time, no paid package dependency.
* Colab AI is reached only through Google Colab's built-in helper
  (``from google.colab import ai``), and only when available.
* No student uploads — no ``files.upload`` call, no image upload, no
  audio upload, no ``ipywidgets``.
* No private-data prompts. The student always reviews AI output and makes
  the final decision.

After forking, run ``make sync-colab-urls`` to rewrite each lab's Step 1
URL from ``interactives/_metadata.yml``.
"""

LAB_TITLES = {
    "class-01": "Lessons 1-2 Colab Lab: Prompt Playground",
    "class-02": "Lessons 3-4 Colab Lab: English Decision Matrix",
    "class-03": "Lessons 5-6 Colab Lab: Source-Grounded Answer",
    "class-04": "Lessons 7-8 Colab Lab: Visual Description and Speaking Script",
    "class-05": "Lessons 9-10 Colab Lab: English AI Decision Toolkit Builder",
}

PREFERRED_MODELS = [
    "google/gemini-2.5-flash-lite",
    "google/gemini-2.0-flash-lite",
    "google/gemini-2.5-flash",
    "google/gemini-2.0-flash",
]


def show(text):
    """Render Markdown text inside the notebook."""
    from IPython.display import Markdown, display

    display(Markdown(str(text)))


def get_colab_ai_model():
    """Try Colab AI automatically. Returns (ai_module, model_name, error_message)."""
    try:
        from google.colab import ai
    except Exception:
        return None, None, (
            "Colab AI is not available in this runtime. "
            "Continue with the regular lab steps."
        )
    try:
        models = ai.list_models()
    except Exception:
        return None, None, (
            "Colab AI models could not be listed. "
            "Continue with the regular lab steps."
        )
    for model in PREFERRED_MODELS:
        if model in models:
            return ai, model, ""
    if models:
        return ai, models[0], ""
    return None, None, (
        "No Colab AI models are available. "
        "Continue with the regular lab steps."
    )


def safe_ai_response(student_task, task_type="general", source_text=None):
    """Ask Colab AI to help with a small student task. Safe, beginner-friendly, never sends private data."""
    ai, model_name, error = get_colab_ai_model()
    if error:
        return error

    safety_preamble = (
        "You are helping an English learner. "
        "Use simple English. "
        "Do not ask for private information. "
        "Do not make the final decision for the student. "
        "If information is missing, say what is missing."
    )
    if task_type == "source_answer" or source_text is not None:
        safety_preamble += " Use only the source text provided by the student."
    if task_type == "decision_matrix_review":
        safety_preamble += " Do not pick the final option. The student decides."
    if task_type == "script_review":
        safety_preamble += (
            " Do not describe a real person. Do not generate an image. "
            "Do not add facts."
        )
    if task_type == "workflow_review":
        safety_preamble += (
            " Do not write the final portfolio for the student. "
            "Do not say the work is finished."
        )

    safe_prompt = safety_preamble + "\n\nStudent task:\n" + str(student_task)

    try:
        return ai.generate_text(safe_prompt, model_name=model_name)
    except Exception:
        return "AI response was not available. Continue with the regular lab steps."


def show_ai_answer(title, answer):
    """Display an AI answer in a code-fenced block for safe rendering."""
    show("**" + str(title) + " (review carefully):**\n\n```text\n" + str(answer) + "\n```")


def show_ai_check_block():
    """Show the standard 'Check the AI answer' review checklist."""
    show(
        "### Check the AI answer\n\n"
        "AI can help, but I must check it.\n\n"
        "1. Did AI use only safe information?\n"
        "2. Did AI invent anything?\n"
        "3. What should I verify?\n"
        "4. What will I keep, change, or reject?\n"
        "5. I make the final decision."
    )


def show_portfolio_markdown(portfolio_md):
    """Display a portfolio Markdown block in a copy-friendly code fence."""
    show("### Copy this to your portfolio\n\n```markdown\n" + str(portfolio_md) + "\n```")


def verify_quote_in_source(quote, source_text):
    """Tell the student whether the quote appears in the source. Returns True/False."""
    q = " ".join(str(quote).split()).lower()
    s = " ".join(str(source_text).split()).lower()
    if q and q in s:
        show("✅ Yes, this quote appears in the source.")
        return True
    show("⚠️ Check again. This quote was not found in the source.")
    return False


def start_e4a_lab(lab_id):
    """Greet the student and report Colab AI availability."""
    title = LAB_TITLES.get(lab_id, "E4A Colab Lab")
    _, model, message = get_colab_ai_model()
    if model:
        ai_status = (
            "**Colab AI is ready.** Continue to Step 2."
        )
    else:
        ai_status = "**" + str(message or "Colab AI is not available. Continue with the regular lab steps.") + "**"
    show(
        "### " + title + "\n\n"
        + ai_status + "\n\n"
        "You do **not** need to know Python. Just edit the safe examples and run each cell. "
        "Available Colab AI models may change over time."
    )


# Lab-specific helpers. Each one wraps a single safe_ai_response call so the
# student-facing notebook cell is short.

def ai_review_prompt(prompt_text):
    """Lessons 1-2: ask Colab AI for a short demo answer to the student's ZONI CLEAR prompt."""
    task = (
        "A student wrote this ZONI CLEAR prompt for an AI tool. "
        "Give a short, simple demo answer that an AI tool might produce. "
        "Use simple English and keep the answer short. "
        "Remind the student to check the answer before using it.\n\n"
        "Prompt:\n" + str(prompt_text)
    )
    return safe_ai_response(task, task_type="prompt_review")


def ai_review_decision_matrix(decision_question, options, criteria, scores):
    """Lessons 3-4: ask Colab AI for missing criteria, assumptions, risks. Never picks the final option."""
    options_text = ", ".join(str(o) for o in options)
    criteria_text = ", ".join(str(c) for c in criteria)
    rows = []
    for option, opt_scores in zip(options, scores):
        rows.append(
            "- " + str(option) + ": " + ", ".join(str(s) for s in opt_scores)
        )
    matrix_text = "\n".join(rows)
    task = (
        "Look at this English decision matrix and give simple feedback. "
        "Do NOT pick the final option. The student decides.\n\n"
        "Decision: " + str(decision_question) + "\n"
        "Options: " + options_text + "\n"
        "Criteria: " + criteria_text + "\n"
        "Scores:\n" + matrix_text + "\n\n"
        "Please give me:\n"
        "1. One criterion that may be missing.\n"
        "2. One assumption I should check.\n"
        "3. One risk I might forget.\n"
        "Use simple English. Keep your answer short."
    )
    return safe_ai_response(task, task_type="decision_matrix_review")


def ai_answer_from_source(source_text, question):
    """Lessons 5-6: ask AI to answer using ONLY the source text. Replies with the unsupported phrase if not found."""
    if not source_text:
        return "No source loaded. Please load a source first."
    task = (
        "Answer the student's question using ONLY the source text below. "
        "If the source does not answer the question, reply exactly: "
        "'I cannot answer from the provided source.'\n\n"
        "Source text:\n" + str(source_text) + "\n\n"
        "Question:\n" + str(question) + "\n\n"
        "Reply format: a short answer in simple English, then a short quote "
        "from the source as evidence."
    )
    return safe_ai_response(task, task_type="source_answer", source_text=source_text)


def ai_review_script(script_text):
    """Lessons 7-8: ask AI to suggest a simpler version of the script. Text-only, no real people."""
    task = (
        "Revise this English speaking script to be clearer and simpler. "
        "Keep the same meaning. Do NOT add facts. "
        "Do NOT describe a real person. Do NOT generate an image. "
        "Keep it between 100 and 150 words.\n\n"
        "Script:\n" + str(script_text)
    )
    return safe_ai_response(task, task_type="script_review")


def ai_review_workflow(workflow_summary):
    """Lessons 9-10: ask AI to review the student's workflow. Cannot write the final portfolio or certify completion."""
    task = (
        "Read this student's English AI workflow and give short, simple feedback. "
        "Use simple English. "
        "Do NOT write the final portfolio for me. "
        "Do NOT say my work is finished.\n\n"
        "Please give me:\n"
        "1. One safety improvement.\n"
        "2. One sentence I can make clearer.\n"
        "3. One step I might be missing.\n\n"
        + str(workflow_summary)
    )
    return safe_ai_response(task, task_type="workflow_review")

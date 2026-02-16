
import io
import json
import os
import pickle
import re
import sys
import traceback
from contextlib import redirect_stdout, redirect_stderr
from urllib import request


MAX_PREVIEW_CHARS = 1000

SAFE_IMPORT_ALLOWLIST = {
    "re",
    "json",
    "math",
    "statistics",
    "itertools",
    "functools",
    "collections",
    "string",
    "textwrap",
    "datetime",
    "time",
    "decimal",
    "fractions",
    "heapq",
    "bisect",
    "operator",
    "typing",
    "dataclasses",
    "enum",
    "copy",
    "pprint",
    "csv",
    "sys",
}


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = str(name).split(".")[0]
    if root not in SAFE_IMPORT_ALLOWLIST:
        raise ImportError(
            f"Import '{name}' is blocked. Only standard-library modules are allowed: {sorted(SAFE_IMPORT_ALLOWLIST)}"
        )

    return __import__(name, globals, locals, fromlist, level)


def _safe_builtins():
    allowed = {
        "print": print,
        "len": len,
        "str": str,
        "int": int,
        "float": float,
        "list": list,
        "dict": dict,
        "set": set,
        "tuple": tuple,
        "bool": bool,
        "type": type,
        "isinstance": isinstance,
        "issubclass": issubclass,
        "enumerate": enumerate,
        "zip": zip,
        "map": map,
        "filter": filter,
        "sorted": sorted,
        "reversed": reversed,
        "range": range,
        "min": min,
        "max": max,
        "sum": sum,
        "abs": abs,
        "round": round,
        "any": any,
        "all": all,
        "pow": pow,
        "divmod": divmod,
        "chr": chr,
        "ord": ord,
        "hex": hex,
        "bin": bin,
        "oct": oct,
        "repr": repr,
        "ascii": ascii,
        "format": format,
        "hash": hash,
        "id": id,
        "iter": iter,
        "next": next,
        "slice": slice,
        "callable": callable,
        "hasattr": hasattr,
        "getattr": getattr,
        "setattr": setattr,
        "delattr": delattr,
        "dir": dir,
        "vars": vars,
        "bytes": bytes,
        "bytearray": bytearray,
        "memoryview": memoryview,
        "complex": complex,
        "object": object,
        "super": super,
        "property": property,
        "staticmethod": staticmethod,
        "classmethod": classmethod,
        "open": open,
        "__import__": _safe_import,
        "Exception": Exception,
        "BaseException": BaseException,
        "ValueError": ValueError,
        "TypeError": TypeError,
        "KeyError": KeyError,
        "IndexError": IndexError,
        "AttributeError": AttributeError,
        "FileNotFoundError": FileNotFoundError,
        "OSError": OSError,
        "IOError": IOError,
        "RuntimeError": RuntimeError,
        "NameError": NameError,
        "ImportError": ImportError,
        "StopIteration": StopIteration,
        "AssertionError": AssertionError,
        "NotImplementedError": NotImplementedError,
        "ArithmeticError": ArithmeticError,
        "LookupError": LookupError,
        "Warning": Warning,
    }
    blocked = {
        "input": None,
        "eval": None,
        "exec": None,
        "compile": None,
        "globals": None,
        "locals": None,
    }
    allowed.update(blocked)
    return allowed


def _load_context(context_path):
    with open(context_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _load_locals(state_path, context_path):
    if os.path.exists(state_path) and os.path.getsize(state_path) > 0:
        with open(state_path, "rb") as f:
            loaded = pickle.load(f)
            if isinstance(loaded, dict):
                return loaded
    return {"context": _load_context(context_path)}


def _dump_locals(state_path, values):
    serializable = {}
    dropped = []

    for key, value in values.items():
        if key.startswith("_"):
            continue
        try:
            pickle.dumps(value)
            serializable[key] = value
        except Exception:
            dropped.append(key)

    with open(state_path, "wb") as f:
        pickle.dump(serializable, f)

    return serializable, dropped


def _safe_text(value):
    try:
        raw = repr(value)
    except Exception:
        raw = str(type(value))

    total_len = len(raw)
    if total_len > MAX_PREVIEW_CHARS:
        half = MAX_PREVIEW_CHARS // 2
        raw = raw[:half] + "..." + raw[-half:]

    return raw, total_len


def _variable_info(values):
    info = []
    for key, value in values.items():
        if key.startswith("_"):
            continue
        preview, total_len = _safe_text(value)
        info.append(
            {
                "name": key,
                "type_name": type(value).__name__,
                "total_length": total_len,
                "preview": preview,
            }
        )
    return info


def _post_json(endpoint, payload):
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(endpoint, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    with request.urlopen(req, timeout=120) as res:
        data = res.read().decode("utf-8")
    return json.loads(data)


def _make_helpers(endpoint, depth, iteration, locals_ref):
    def llm_query(prompt, model=None):
        if prompt is None or str(prompt).strip() == "":
            raise ValueError("prompt cannot be empty")
        payload = {
            "kind": "single",
            "prompt": str(prompt),
            "model": model,
            "depth": depth,
            "iteration": iteration,
        }
        result = _post_json(endpoint, payload)
        if not result.get("ok"):
            raise RuntimeError(result.get("error", "llm_query failed"))
        return str(result.get("answer", ""))

    def llm_query_batched(prompts, model=None):
        if prompts is None:
            return []
        prompts_list = [str(p) for p in list(prompts)]
        if len(prompts_list) == 0:
            return []

        payload = {
            "kind": "batch",
            "prompts": prompts_list,
            "model": model,
            "depth": depth,
            "iteration": iteration,
        }
        result = _post_json(endpoint, payload)
        if not result.get("ok"):
            raise RuntimeError(result.get("error", "llm_query_batched failed"))
        answers = result.get("answers", [])
        if not isinstance(answers, list):
            return []
        return [str(item) for item in answers]

    def regex_search(pattern, text, flags=""):
        if pattern is None:
            raise ValueError("pattern cannot be empty")
        source = str(text)
        flag_value = 0
        flag_text = str(flags).upper()
        if "I" in flag_text:
            flag_value |= re.IGNORECASE
        if "M" in flag_text:
            flag_value |= re.MULTILINE
        if "S" in flag_text:
            flag_value |= re.DOTALL

        match = re.search(str(pattern), source, flags=flag_value)
        if not match:
            return None

        return {
            "match": match.group(0),
            "groups": list(match.groups()),
            "start": match.start(),
            "end": match.end(),
        }

    def regex_findall(pattern, text, flags=""):
        if pattern is None:
            raise ValueError("pattern cannot be empty")
        source = str(text)
        flag_value = 0
        flag_text = str(flags).upper()
        if "I" in flag_text:
            flag_value |= re.IGNORECASE
        if "M" in flag_text:
            flag_value |= re.MULTILINE
        if "S" in flag_text:
            flag_value |= re.DOTALL

        results = re.findall(str(pattern), source, flags=flag_value)
        if len(results) > 500:
            results = results[:500]
        return results

    def SHOW_VARS():
        return {k: type(v).__name__ for k, v in locals_ref.items() if not k.startswith("_")}

    def FINAL(value):
        locals_ref["_rlm_final_signal"] = {
            "type": "FINAL",
            "answer": str(value),
        }
        return str(value)

    def FINAL_VAR(variable_name):
        key = str(variable_name).strip().strip('"').strip("'")
        if key == "context":
            return (
                "Error: FINAL_VAR('context') is not allowed. "
                "Extract the required answer into a dedicated variable (for example final_answer) "
                "and call FINAL_VAR('final_answer')."
            )
        if key in locals_ref:
            locals_ref["_rlm_final_signal"] = {
                "type": "FINAL_VAR",
                "varName": key,
            }
            return str(locals_ref[key])
        available = [k for k in locals_ref.keys() if not k.startswith("_")]
        if available:
            return (
                f"Error: Variable '{key}' not found. "
                f"Available variables: {available}. "
                "You must create and assign a variable BEFORE calling FINAL_VAR on it."
            )
        return (
            f"Error: Variable '{key}' not found. "
            "No variables have been created yet. "
            "You must create and assign a variable in a REPL block BEFORE calling FINAL_VAR on it."
        )

    return llm_query, llm_query_batched, regex_search, regex_findall, SHOW_VARS, FINAL, FINAL_VAR


def _execute(state_path, context_path, code_path, endpoint, depth, iteration):
    locals_ref = _load_locals(state_path, context_path)
    with open(code_path, "r", encoding="utf-8") as f:
        code = f.read()

    llm_query, llm_query_batched, regex_search, regex_findall, SHOW_VARS, FINAL, FINAL_VAR = _make_helpers(
        endpoint=endpoint,
        depth=depth,
        iteration=iteration,
        locals_ref=locals_ref,
    )

    globals_ref = {
        "__builtins__": _safe_builtins(),
        "__name__": "__main__",
        "llm_query": llm_query,
        "llm_query_batched": llm_query_batched,
        "regex_search": regex_search,
        "regex_findall": regex_findall,
        "SHOW_VARS": SHOW_VARS,
        "FINAL": FINAL,
        "FINAL_VAR": FINAL_VAR,
    }

    combined = {**globals_ref, **locals_ref}

    out_buf = io.StringIO()
    err_buf = io.StringIO()

    with redirect_stdout(out_buf), redirect_stderr(err_buf):
        try:
            exec(code, combined, combined)
        except Exception:
            traceback.print_exc()

    for key, value in combined.items():
        if key not in globals_ref and not key.startswith("_"):
            locals_ref[key] = value

    final_signal = locals_ref.get("_rlm_final_signal")
    if "_rlm_final_signal" in locals_ref:
        del locals_ref["_rlm_final_signal"]

    persisted, dropped = _dump_locals(state_path, locals_ref)
    return {
        "ok": True,
        "stdout": out_buf.getvalue(),
        "stderr": err_buf.getvalue(),
        "variables": _variable_info(persisted),
        "dropped_variables": dropped,
        "final_signal": final_signal,
    }


def _get_var(state_path, context_path, variable_name):
    values = _load_locals(state_path, context_path)
    key = str(variable_name).strip().strip('"').strip("'")

    if key in values:
        return {"ok": True, "value": str(values[key])}

    available = [k for k in values.keys() if not k.startswith("_")]
    if available:
        message = (
            f"Error: Variable '{key}' not found. "
            f"Available variables: {available}. "
            "You must create and assign a variable BEFORE calling FINAL_VAR on it."
        )
    else:
        message = (
            f"Error: Variable '{key}' not found. "
            "No variables have been created yet. "
            "You must create and assign a variable in a REPL block BEFORE calling FINAL_VAR on it."
        )

    return {"ok": True, "value": message}


def main():
    mode = sys.argv[1]

    if mode == "exec":
        state_path = sys.argv[2]
        context_path = sys.argv[3]
        code_path = sys.argv[4]
        endpoint = sys.argv[5]
        depth = int(sys.argv[6])
        iteration = int(sys.argv[7])
        result = _execute(state_path, context_path, code_path, endpoint, depth, iteration)
        print(json.dumps(result))
        return

    if mode == "get_var":
        state_path = sys.argv[2]
        context_path = sys.argv[3]
        variable_name = sys.argv[4]
        result = _get_var(state_path, context_path, variable_name)
        print(json.dumps(result))
        return

    raise ValueError(f"Unsupported mode: {mode}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)

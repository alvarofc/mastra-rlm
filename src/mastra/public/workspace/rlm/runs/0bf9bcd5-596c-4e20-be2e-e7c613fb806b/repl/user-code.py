import re
document_content = context["documents"][0]["content"]
matches = re.findall(r'(puntuación|evaluación).*?(criterios|pesos|porcentajes|umbrales|valores|ponderacion).*?(\d+)', document_content, re.DOTALL)
print(matches)
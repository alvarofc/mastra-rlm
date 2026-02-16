import re

document_content = context["documents"][0]["content"]
pattern = r"puntos por hora"
matches = re.findall(pattern, document_content, re.IGNORECASE)

if matches:
    print("Points per hour mentioned in the document:")
    for match in matches:
        print(f"Points per hour: {match}")
else:
    print("No points per hour mentioned in the document.")
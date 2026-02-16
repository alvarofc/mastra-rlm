import pandas as pd

# Extract documents from context
documents = context["documents"]

# Initialize empty lists to store criteria and requirements
criteria = []
requirements = []

# Iterate over each document
for document in documents:
    # Extract content from document
    content = document["content"]
    
    # Find criteria of evaluation
    start_idx = content.find("Criterios de evaluación")
    if start_idx != -1:
        end_idx = content.find("Requisitos administrativos", start_idx)
        if end_idx == -1:
            end_idx = len(content)
        criteria_section = content[start_idx:end_idx]
        # Extract criteria, max and min points, and exclusions
        lines = criteria_section.splitlines()
        for line in lines:
            if "Criterio" in line:
                criterio = line.split(":")[1].strip()
                puntos_maximos = line.split(":")[2].split(",")[0].strip()
                puntos_minimos = line.split(":")[2].split(",")[1].strip()
                exclusiones = line.split(":")[3].strip() if len(line.split(":")) > 3 else ""
                criteria.append({
                    "criterio": criterio,
                    "puntos_maximos": puntos_maximos,
                    "puntos_minimos": puntos_minimos,
                    "exclusiones": exclusiones
                })
    
    # Find administrative and technical requirements
    start_idx = content.find("Requisitos administrativos")
    if start_idx != -1:
        end_idx = content.find("Modelo de puntuación", start_idx)
        if end_idx == -1:
            end_idx = len(content)
        requirements_section = content[start_idx:end_idx]
        # Extract requirements
        lines = requirements_section.splitlines()
        for line in lines:
            if "Requisito" in line:
                requisito = line.split(":")[1].strip()
                requirements.append(requisito)

# Create dataframes for criteria and requirements
if criteria and requirements:
    criteria_df = pd.DataFrame(criteria)
    requirements_df = pd.DataFrame(requirements, columns=["Requisito"])
    # Store dataframes in context
    context["criteria_df"] = criteria_df
    context["requirements_df"] = requirements_df
    FINAL_VAR(context)
else:
    print("No criteria or requirements found.")
    FINAL_VAR(context)
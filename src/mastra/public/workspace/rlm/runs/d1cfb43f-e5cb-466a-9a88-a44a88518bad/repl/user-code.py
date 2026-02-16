def provide_final_answer(points, refined_guidance):
    final_answer = "To maximize points in this convocatoria, focus on meeting the criteria that award the most points."
    for point in points:
        final_answer += f" The criterion '{point}' awards up to {points[point]} points."
    for guide in refined_guidance:
        final_answer += f" {guide}"
    return final_answer

final_answer = provide_final_answer(points, refined_guidance)
print("Final Answer:", final_answer)
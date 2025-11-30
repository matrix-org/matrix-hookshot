if (data.object_kind === "pipeline") {
    color = "white";
    if (data.object_attributes.status === "success") {
        color = "#00ff00";
    } else if (data.object_attributes.status === "failed") {
        color = "red";
    }
    text = `[<strong><a href="${data.project.web_url}">${data.project.path_with_namespace}</a></strong>]<br>`;
    text += `CI pipeline <font color="${color}">${data.object_attributes.detailed_status}</font> <strong><a href="${data.project.web_url}/-/pipelines/${data.object_attributes.id}">#${data.object_attributes.id}</a></strong> ref <em>${data.object_attributes.ref}</em> (commit <a href="${data.project.web_url}/-/commit/${data.commit.id}"><code>${data.commit.id.slice(0,7)}</code></a> "<em>${data.commit.message}</em>")<br>`;
    if ("builds" in data) {
        text += "<ol>";
        for (build of data.builds) {
            text += `<li><a href="${data.project.web_url}/-/jobs/${build.id}">#${build.id}</a> <em>${build.name}</em>`;
            if (build.runner) {
                text += ` on runner <em>${build.runner.description}</em>`;
            }
            text += "</li>";
        }
        text += "</ol>";
    }

    type = data.build_status === "failed" ? "m.text" : "m.notice";
    result = {
        plain: text,
        html: text,
        version: "v2",
        msgtype: type
    }
} else {
    result = {
        plain: "unsupported event, see message JSON source",
        version: "v2",
        msgtype: "m.notice"
    }
}

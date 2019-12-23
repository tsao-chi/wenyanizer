import React from "react";
import AceEditor from "react-ace";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/theme-mono_industrial";


export const Component = (props) => {
  return (
    <AceEditor
        value={props.value}
      mode="javascript"
      theme="mono_industrial"
      onChange={props.onChange}
      className="editor"
      name="JavaScript"
      editorProps={{ $blockScrolling: true }}
    />
  );
};